/* sim.c — la partida: jugadores (G.Player.update), caminos (G.Path) y enemigos (Enemy.update, G.EnemyMgr), para N
 * jugadores en la misma copia. Fase 2 de CORE.md: moverse. Aún no: ataques, daño, estados que hacen daño, jefes, saltos,
 * escudos, explosiones, disparos (llegan con el combate). Mismo orden de cuentas que js/app.js (banco: bench-sim.cjs).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include "core.h"
#include <math.h>
#include <string.h>

Sim S;
#define TS WORLD_TS
#define PI 3.141592653589793

static inline double damp(double a, double b, double rate, double dt) { return b + (a - b) * exp(-rate * dt); }   /* G.U.damp */

/* ================= jugadores ================= */

int sim_add_player(int dex, uint32_t types, double x, double y, double r, double spd) {
  if (S.np >= MAXPL) return -1;
  Player *p = &S.pl[S.np];
  const DexStat *mon = dex_of(dex);
  *p = (Player){ .on = true, .dex = dex, .types = types, .mon = mon, .x = x, .y = y, .r = r, .baseSpd = spd, .spdMul = 1,
                 .aim = PI / 2, .moveAngle = PI / 2, .view = 700, .maxHp = mon ? mon->hp : 100, .baseAtk = mon ? mon->atk : 50,
                 .atkMul = 1, .cdMul = 1, .level = S.level ? S.level : 1, .lastPatch = -1,
                 .magnet = 78, .xpMul = 1, .ab = -1, .abType = -1, .item = -1, .sashT = -999, .sturdyAt = -999, .power = -1 };
  for (int i = 0; i < ORB_SLOTS; i++) p->orbId[i] = -1;
  p->hp = p->maxHp;
  return S.np++;
}

int proj_nearest(double x, double y, double max) {   /* G.Projectiles.nearest */
  int best = -1; double bd = max * max;
  for (int i = 0; i < S.ne; i++) {
    const Enemy *e = &S.en[i];
    if (e->dead || (e->arceus && S.arcShield)) continue;   /* con legendarios vivos, a Arceus no se le apunta */
    const double d = u_dist2(x, y, e->x, e->y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* El enemigo más cercano dentro de ±25° de la dirección a (a menos de 520): Player.enemyAlong. */
static int enemy_along(const Player *p, double a) {
  int best = -1; double bd = 520 * 520;
  const double ca = cos(a), sa = sin(a), cosMax = cos(0.44);
  for (int i = 0; i < S.ne; i++) {
    const Enemy *e = &S.en[i];
    if (e->dead) continue;
    const double dx = e->x - p->x, dy = e->y - p->y, d2 = dx * dx + dy * dy;
    if (d2 >= bd || d2 < 1) continue;
    if ((dx * ca + dy * sa) / sqrt(d2) < cosMax) continue;
    bd = d2; best = i;
  }
  return best;
}

/* G.Player.spd (sin la Sentencia: fase 5). La Rapidosfera, aparte (en el JS sube spdMul). */
static double player_spd(const Player *p) {
  const bool steady = abil_flags(p) & AF_STEADY, stuck = p->slowT > 0 && !steady;
  const double s = p->baseSpd * p->spdMul * (1 + p->bn[BF_SPD] * p->bamt[BF_SPD]) * (stuck ? 0.5 : 1) * abil_speed(p) *
                   (p->orbT[ORB_QUICK] > 0 ? 1.4 : 1);
  const double w = wx_speed(p->types);
  double slow = 1;
  if (p->inLiquid && !steady) { const LiqFx f = world_liquid_effect(p->types); slow = f.slow ? f.slow : 1; }
  const double v = s * slow * w;
  return S.judge ? (v <= 130 ? v : 130 + (v - 130) * 0.25) : v;   /* Sentencia: tope suave (capSpd) */
}

void player_update(Player *p, double dt) {
  orb_update(p, dt);
  if (p->dead) return;
  if (p->invuln > 0) p->invuln -= dt;
  for (int k = 0; k < BF_N; k++) if (p->bn[k] > 0) { p->bt[k] -= dt; if (p->bt[k] <= 0) p->bn[k] = 0; }
  if (p->slowT > 0) p->slowT -= dt;
  if (p->bellHeal > 0) { const double h = fmin(p->bellHeal, 4 * dt); p->hp = fmin(p->maxHp, p->hp + h); p->bellHeal -= h; }   /* Cascabel Concha */
  if (p->power >= 0 && (p->powerT -= dt) <= 0) { power_apply(p, -1); p->power = -1; }   /* poder de altar */
  { const double rg = p->regenFlat + p->bn[BF_REGEN] * p->bamt[BF_REGEN]; if (rg > 0) p->hp = fmin(p->maxHp, p->hp + rg * dt); }   /* Player.regen */
  abil_tick(p, dt);

  const double ax = p->in.ax, ay = p->in.ay;
  p->walking = ax != 0 || ay != 0;
  const double s = player_spd(p);
  const bool slide = p->inLiquid && world_liquid_effect(p->types).slide;   /* hielo: resbala */
  p->svx = slide ? damp(p->svx, ax * s * 1.15, 1.6, dt) : ax * s;
  p->svy = slide ? damp(p->svy, ay * s * 1.15, 1.6, dt) : ay * s;
  /* En pasos de media radio como mucho: con turbo (dt ×4) o pocos fps, un paso entero metía el centro en el muro y
   * world_collide lo sacaba por el otro lado (se atravesaba al insistir). Con un paso (lo normal) es lo mismo que el JS. */
  const double mx = p->svx * dt, my = p->svy * dt;
  const int steps = (int)fmin(64, fmax(1, ceil(fmax(fabs(mx), fabs(my)) / fmax(p->r * 0.5, 1))));
  for (int k = 0; k < steps; k++) {
    p->x += mx / steps;
    p->y += my / steps;
    world_collide(&p->x, &p->y, p->r);
  }
  if (p->walking) p->moveAngle = atan2(ay, ax);
  p->inLiquid = !(abil_flags(p) & AF_LEVITATE) && world_terrain((int32_t)floor(p->x / TS), (int32_t)floor(p->y / TS)) == TER_LIQUID;
  if (p->inLiquid) {   /* lava y parecidos */
    const LiqFx le = world_liquid_effect(p->types);
    if (le.dmg && !(abil_flags(p) & AF_LAVAPROOF) && (p->lavaTick -= dt) <= 0) {
      p->lavaTick = le.every; p->invuln = 0;
      player_hurt(p, fmax(le.flat, p->maxHp * le.dmg * 0.5), -1, false, CAT_NONE);
      if (p->dead) return;
    }
  }

  /* Blanco (Player.update): a distancia (proyectil, rayo), el jefe si está a tiro > lo que te toca > el más cercano;
   * cuerpo a cuerpo y el resto, lo que te toca > el jefe > el más cercano; sin enemigos, la roca o el cofre más cercano. */
  const PMove *am = p->nslot && p->slotn[p->active] ? &p->mv[p->slot[p->active][0]] : NULL;
  const int ak = am ? core_moves[am->def].kind : -1;
  const bool ranged = ak == MK_PROJECTILE || ak == MK_BEAM;
  const int threat = proj_nearest(p->x, p->y, p->r + 24);
  int boss = -1;
  for (int i = 0; i < S.ne && boss < 0; i++) if (S.en[i].boss && !S.en[i].dead && js_hypot(S.en[i].x - p->x, S.en[i].y - p->y) < 330) boss = i;
  int tg = ranged ? (boss >= 0 ? boss : threat) : (threat >= 0 ? threat : boss);
  if (tg < 0) tg = proj_nearest(p->x, p->y, 520);
  const Prop *prop = tg < 0 ? world_nearest_breakable(p->x, p->y, 200) : NULL;
  p->manualAim = p->in.aimx || p->in.aimy;
  if (p->manualAim) {
    p->aim = atan2(p->in.aimy, p->in.aimx);
    const int al = enemy_along(p, p->aim);
    if (al >= 0) tg = al;
  }
  p->hasTarget = tg >= 0 || prop;
  p->targetId = tg >= 0 ? S.en[tg].id : 0;
  if (tg >= 0) { p->tx = S.en[tg].x; p->ty = S.en[tg].y; } else if (prop) { p->tx = prop->x; p->ty = prop->y; }
  if (!p->manualAim) {
    if (p->hasTarget) p->aim = atan2(p->ty - p->y, p->tx - p->x);
    else if (p->walking) p->aim = p->moveAngle;
  }
}

/* ================= caminos (G.Path) ================= */

#define UNSEEN 0x7fff
static const int D8[8][2] = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 }, { 1, 1 }, { 1, -1 }, { -1, 1 }, { -1, -1 } };
static struct { bool on; int32_t ox, oy; int16_t dist[PATH_N * PATH_N]; uint8_t open[PATH_N * PATH_N]; } fields[MAXPL];
static double path_timer;

void path_build(int pi) {
  const Player *pl = &S.pl[pi];
  const int32_t px = (int32_t)floor(pl->x / TS), py = (int32_t)floor(pl->y / TS);
  const int32_t ox = px - PATH_R, oy = py - PATH_R;
  __typeof__(fields[0]) *f = &fields[pi];
  static int queue[PATH_N * PATH_N];
  f->on = true; f->ox = ox; f->oy = oy;
  for (int i = 0; i < PATH_N * PATH_N; i++) f->dist[i] = UNSEEN;
  for (int j = 0; j < PATH_N; j++) for (int i = 0; i < PATH_N; i++) f->open[j * PATH_N + i] = world_walkable(ox + i, oy + j);
  const int start = PATH_R * PATH_N + PATH_R;
  f->open[start] = 1;
  f->dist[start] = 0;
  int head = 0, tail = 0;
  queue[tail++] = start;
  while (head < tail) {
    const int c = queue[head++];
    const int cx = c % PATH_N, cy = c / PATH_N, d = f->dist[c] + 1;
    for (int k = 0; k < 8; k++) {
      const int nx = cx + D8[k][0], ny = cy + D8[k][1];
      if (nx < 0 || ny < 0 || nx >= PATH_N || ny >= PATH_N) continue;
      const int n = ny * PATH_N + nx;
      if (!f->open[n] || f->dist[n] != UNSEEN) continue;
      if (k >= 4 && (!f->open[cy * PATH_N + nx] || !f->open[ny * PATH_N + cx])) continue;   /* sin cortar esquinas */
      f->dist[n] = (int16_t)d;
      queue[tail++] = n;
    }
  }
}

const int16_t *path_field(int pi, int32_t *ox, int32_t *oy) {
  if (!fields[pi].on) return NULL;
  *ox = fields[pi].ox; *oy = fields[pi].oy;
  return fields[pi].dist;
}

void path_update(double dt) {
  path_timer -= dt;
  if (path_timer > 0) return;
  path_timer = 0.35;
  for (int i = 0; i < MAXPL; i++) {
    if (i >= S.np || !S.pl[i].on) fields[i].on = false;
    else if (!S.pl[i].dead) path_build(i);
  }
}

/* ¿Cabe un cuerpo de radio r en línea recta de a a b? */
static bool clear_line(int pi, double ax, double ay, double bx, double by, double r) {
  const __typeof__(fields[0]) *f = &fields[pi];
  const double len = js_hypot(bx - ax, by - ay);
  if (len < 1) return true;
  const double ux = (bx - ax) / len, uy = (by - ay) / len;
  const double w = fmin(r * 0.9, TS * 0.45), side[3] = { -w, 0, w };
  for (double d = 0; d <= len; d += TS * 0.4) {
    const double cx = ax + ux * d, cy = ay + uy * d;
    for (int k = 0; k < 3; k++) {
      const double s = side[k];
      const int32_t x = (int32_t)floor((cx - uy * s) / TS) - f->ox, y = (int32_t)floor((cy + ux * s) / TS) - f->oy;
      if (x < 0 || y < 0 || x >= PATH_N || y >= PATH_N) return false;
      if (!f->open[y * PATH_N + x]) return false;
    }
  }
  return true;
}

/* Dirección para que e llegue hasta el jugador pi rodeando obstáculos; false si va directo. */
bool path_dir(Enemy *e, int pi, double *dx, double *dy) {
  const __typeof__(fields[0]) *f = &fields[pi];
  if (!f->on) return false;
  const int32_t tx = (int32_t)floor(e->x / TS) - f->ox, ty = (int32_t)floor(e->y / TS) - f->oy;
  if (tx < 0 || ty < 0 || tx >= PATH_N || ty >= PATH_N) return false;
  const int here = f->dist[ty * PATH_N + tx];
  if (here <= 1 || here == UNSEEN) return false;
  /* Vista despejada: en línea recta. Se mira cada 0,2 s por enemigo (en el JS, con el reloj de pared). */
  if (!e->losAt || S.time - e->losAt > 0.2) { e->losAt = S.time; e->los = clear_line(pi, e->x, e->y, S.pl[pi].x, S.pl[pi].y, e->r); }
  if (e->los) return false;
  int bx = tx, by = ty, best = here;
  for (int k = 0; k < 8; k++) {
    const int x = tx + D8[k][0], y = ty + D8[k][1];
    if (x < 0 || y < 0 || x >= PATH_N || y >= PATH_N) continue;
    const int v = f->dist[y * PATH_N + x];
    if (v >= best) continue;
    if (k >= 4 && (!f->open[ty * PATH_N + x] || !f->open[y * PATH_N + tx])) continue;
    best = v; bx = x; by = y;
  }
  if (bx == tx && by == ty) return false;
  double gx = (f->ox + bx + 0.5) * TS, gy = (f->oy + by + 0.5) * TS;
  if (!clear_line(pi, e->x, e->y, gx, gy, e->r)) { gx = (f->ox + tx + 0.5) * TS; gy = (f->oy + ty + 0.5) * TS; }
  u_norm(gx - e->x, gy - e->y, dx, dy);
  return true;
}

/* ================= enemigos ================= */

static bool keeps_distance(int b) { return b == BEH_RANGED || b == BEH_FAN || b == BEH_BEAMER || b == BEH_ZONER || b == BEH_HEALER || b == BEH_SUMMONER; }

int sim_add_enemy(const Enemy *t) {
  if (S.ne >= MAXEN) return 0;
  Enemy *e = &S.en[S.ne++];
  *e = *t;
  e->id = ++S.next_id;
  e->hp = e->maxHp;
  e->mon = dex_of(e->dex);
  e->cat = e->mon && e->mon->pa >= 0 && e->mon->sa >= 0 && e->mon->sa > e->mon->pa ? CAT_SPEC : CAT_PHYS;   /* G.Stats.sideOf */
  if (!e->types) e->types = 1u << TY_NORMAL;
  /* tipo de sus golpes: el primero de los suyos (quien lo crea lo pasa; si no es de los suyos, el de bit más bajo) */
  if (e->atkType < 0 || e->atkType >= TY_N || !(e->types & 1u << e->atkType)) { for (int t = 0; t < TY_N; t++) if (e->types & 1u << t) { e->atkType = t; break; } }
  if (!e->fanN) e->fanN = 5;
  if (!e->shotDmg) e->shotDmg = 10;
  e->lastHit = -1;
  if (!e->range) e->range = 200;
  e->shotCd = e->shotCd0 ? rng_range(&S.rng, 0.3, e->shotCd0) : 0;
  e->skillCd = rng_range(&S.rng, 1, 4);   /* escudos / saltos */
  e->cast = BA_NONE;
  if (!e->shotCd0) e->shotCd0 = 2;
  e->phase = PH_WALK; e->side = 1;
  return e->id;
}

void enemy_update(Enemy *e, int pi, double dt) {
  const Player *pl = &S.pl[pi];
  if (e->dead || e->arceus) return;   /* (Arceus va donde lo pone el JS) */
  if (e->touchCd > 0) e->touchCd -= dt;
  if (e->rd > 0) e->rd *= exp(-dt / 6);
  if (e->slowT > 0) { e->slowT -= dt; if (e->slowT <= 0) e->slow = 0; }
  if (e->burn > 0) {
    e->burnT -= dt; e->burnTick -= dt;
    if (e->burnTick <= 0) { e->burnTick = 0.5; enemy_hurt(e, e->judge ? 1.5 * e->burn : 1.6 * e->burn * (1 + pl->level * 0.06), 0, 0, 0, -1); }
    if (e->burnT <= 0) e->burn = 0;
  }
  if (e->poison > 0) {
    e->poisonT -= dt; e->poisonTick -= dt;
    if (e->poisonTick <= 0) {
      e->poisonTick = 0.6;
      const double pct = e->maxHp <= 60000 ? e->maxHp : 60000 * sqrt(e->maxHp / 60000);
      enemy_hurt(e, e->judge ? 1.5 * e->poison : pct * 0.012 * e->poison + 1, 0, 0, 0, -1);
    }
    if (e->poisonT <= 0) e->poison = 0;
  }
  if (e->dead) return;

  double terrain = 1;
  if (!e->flying && !e->legend && !e->judge && world_terrain((int32_t)floor(e->x / TS), (int32_t)floor(e->y / TS)) == TER_LIQUID) {
    const LiqFx le = world_liquid_effect(e->types);
    if (le.dmg) {
      e->lavaTick -= dt;
      if (e->lavaTick <= 0) { e->lavaTick = le.every; enemy_hurt(e, 6 + e->maxHp * 0.04, 0, 0, 0, -1); }
      if (e->dead) return;
    } else if (le.slow) terrain = le.slow < 0.5 ? 0.45 : 0.55;
  }
  if (e->sleepT > 0) {   /* dormido: sólo lo mueve un empujón */
    e->sleepT -= dt;
    e->x += e->kx * dt; e->y += e->ky * dt;
    e->kx *= pow(0.0015, dt); e->ky *= pow(0.0015, dt);
    e->vx = e->vy = 0;
    return;
  }
  if (e->stunT > 0) { e->stunT -= dt; e->vx = e->vy = 0; return; }

  const double spd = e->spd * (1 - e->slow) * terrain * wx_speed(e->types);
  double dx, dy;
  u_norm(pl->x - e->x, pl->y - e->y, &dx, &dy);
  const double dist = js_hypot(pl->x - e->x, pl->y - e->y);

  if (e->beh == BEH_THIEF) {   /* huye en zigzag */
    e->zig += dt;
    const bool near = dist < 300;
    const double a = atan2(-dy, -dx) + sin(e->zig * 2.2) * 0.7, k = near ? 1 : 0.35;
    const double vx0 = cos(a) * spd * k, vy0 = sin(a) * spd * k, ox = e->x, oy = e->y;
    e->x += (vx0 + e->kx) * dt; e->y += (vy0 + e->ky) * dt;
    e->kx *= pow(0.0015, dt); e->ky *= pow(0.0015, dt);
    if (world_collide(&e->x, &e->y, e->r) && js_hypot(e->x - ox, e->y - oy) < spd * k * dt * 0.3) e->zig += 1.4;
    e->vx = vx0; e->vy = vy0;
    return;
  }
  if (e->beh == BEH_RUNNER && pl->moved) {   /* va a donde vas a estar */
    const double lead = u_clamp(dist / fmax(60, spd), 0, 1.4);
    u_norm(pl->x + pl->vx * lead - e->x, pl->y + pl->vy * lead - e->y, &dx, &dy);
  }
  if (foe_skills(e, pl, dist, dt)) { e->vx = e->vy = 0; return; }   /* escudos, salto, mecha del kamikaze */

  if (e->sideT > 0) {   /* atascado: rodea por un lado */
    e->sideT -= dt;
    const double a = atan2(dy, dx) + e->side * 1.25;
    dx = cos(a); dy = sin(a);
  }
  if (!e->flying && e->phase != PH_DASH && e->sideT <= 0) {
    double px, py;
    if (path_dir(e, pi, &px, &py) && !(keeps_distance(e->beh) && dist < e->range * 0.82)) { dx = px; dy = py; }
  }

  double vx = dx * spd, vy = dy * spd;
  if (e->boss) foe_boss_move(e, pl, dt, dist, dx, dy, spd, &vx, &vy);
  else if (e->beh == BEH_CHARGER) {
    e->pt -= dt;
    if (e->phase == PH_WALK) {
      if (dist < 200 && e->pt <= 0) { e->phase = PH_AIM; e->pt = 0.55; }
    } else if (e->phase == PH_AIM) {
      vx = vy = 0;
      if (e->pt <= 0) { e->phase = PH_DASH; e->pt = 0.42; e->dx = dx; e->dy = dy; }
    } else {
      vx = e->dx * spd * 3.4; vy = e->dy * spd * 3.4;
      if (e->pt <= 0) { e->phase = PH_WALK; e->pt = 1.1; }
    }
  } else if (keeps_distance(e->beh)) {
    const double keep = e->range * 0.82;
    double ddx, ddy;
    u_norm(pl->x - e->x, pl->y - e->y, &ddx, &ddy);
    if (dist < keep * 0.75) { vx = -ddx * spd * 0.8; vy = -ddy * spd * 0.8; }
    else if (dist < keep) { vx *= 0.1; vy *= 0.1; }
    e->shotCd -= dt;
    if (e->shotCd <= 0 && dist < e->range) { e->shotCd = e->shotCd0; foe_special(e, pl, ddx, ddy); }
  }

  const double ox = e->x, oy = e->y;
  e->x += e->kx * dt; e->y += e->ky * dt;
  e->kx *= pow(0.0015, dt); e->ky *= pow(0.0015, dt);
  e->x += vx * dt; e->y += vy * dt;
  e->vx = vx; e->vy = vy;
  if (!e->flying && world_collide(&e->x, &e->y, e->r)) {
    const double want = js_hypot(vx, vy) * dt, got = js_hypot(e->x - ox, e->y - oy);
    if (want > 0.5 && got < want * 0.35) {
      e->stuckT += dt;
      if (e->stuckT > 0.35 && e->sideT <= 0) { e->sideT = 0.7; e->stuckT = 0; e->side = rng_next(&S.rng) < 0.5 ? -1 : 1; }
    } else e->stuckT = 0;
  }
}

/* ---------------- rejilla (la de EnemyMgr: celdas de 52, misma clave y mismo orden) ---------------- */

#define CELL 52
#define GB 4096   /* huecos de la tabla (potencia de 2, > 2 × MAXEN) */
static struct { int32_t key; int head, tail; bool used; } grid[GB];
static int gnext[MAXEN], gused[GB], ngused;

static inline int32_t to_i32(double v) { return (int32_t)(uint32_t)(int64_t)v; }   /* ToInt32 */
static inline int32_t gkey(int32_t cx, int32_t cy) { return to_i32(cx * 73856093.0) ^ to_i32(cy * 19349663.0); }
static int gfind(int32_t k, bool make) {
  for (unsigned h = (unsigned)k * 2654435761u >> 20 & (GB - 1);; h = (h + 1) & (GB - 1)) {
    if (!grid[h].used) { if (!make) return -1; grid[h] = (__typeof__(grid[0])){ k, -1, -1, true }; gused[ngused++] = (int)h; return (int)h; }
    if (grid[h].key == k) return (int)h;
  }
}
void enemy_grid(void) {
  for (int i = 0; i < ngused; i++) grid[gused[i]].used = false;
  ngused = 0;
  for (int i = 0; i < S.ne; i++) {
    const Enemy *e = &S.en[i];
    if (e->dead) continue;
    const int b = gfind(gkey((int32_t)floor(e->x / CELL), (int32_t)floor(e->y / CELL)), true);
    gnext[i] = -1;
    if (grid[b].tail < 0) grid[b].head = i; else gnext[grid[b].tail] = i;
    grid[b].tail = i;
  }
}

int sim_query_circle(double x, double y, double r, int *out, int max) {
  int n = 0;
  const int32_t c0x = (int32_t)floor((x - r) / CELL) - 1, c1x = (int32_t)floor((x + r) / CELL) + 1;
  const int32_t c0y = (int32_t)floor((y - r) / CELL) - 1, c1y = (int32_t)floor((y + r) / CELL) + 1;
  for (int32_t cy = c0y; cy <= c1y; cy++) for (int32_t cx = c0x; cx <= c1x; cx++) {
    const int b = gfind(gkey(cx, cy), false);
    if (b < 0) continue;
    for (int i = grid[b].head; i >= 0; i = gnext[i]) {
      const Enemy *e = &S.en[i];
      if (e->dead) continue;
      const double rr = r + e->r;
      if (u_dist2(x, y, e->x, e->y) <= rr * rr && n < max) out[n++] = i;
    }
  }
  return n;
}

void enemy_separate(double dt) {
  for (int k = 0; k < S.ne; k++) {
    Enemy *e = &S.en[k];
    if (e->dead) continue;
    const int32_t cx = (int32_t)floor(e->x / CELL), cy = (int32_t)floor(e->y / CELL);
    double px = 0, py = 0; int n = 0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      const int b = gfind(gkey(cx + i, cy + j), false);
      if (b < 0) continue;
      for (int q = grid[b].head; q >= 0; q = gnext[q]) {
        const Enemy *o = &S.en[q];
        if (o == e || o->dead) continue;
        const double min = (e->r + o->r) * 0.82, dx = e->x - o->x, dy = e->y - o->y, d2 = dx * dx + dy * dy;
        if (d2 > min * min || d2 < 1e-4) continue;
        const double d = sqrt(d2), f = (min - d) / min;
        px += (dx / d) * f; py += (dy / d) * f;
        if (++n > 6) break;
      }
    }
    if (n) {
      e->x += px * 42 * dt;
      e->y += py * 42 * dt;
      if (!e->flying) world_collide(&e->x, &e->y, e->r);
    }
  }
}

/* ================= el paso ================= */

int sim_nearest_player(double x, double y) {
  int best = -1; double bd = INFINITY;
  for (int i = 0; i < S.np; i++) {
    const Player *p = &S.pl[i];
    if (!p->on || p->dead) continue;
    const double d = u_dist2(x, y, p->x, p->y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

static void remove_enemy(int i) { memmove(&S.en[i], &S.en[i + 1], (size_t)(S.ne - i - 1) * sizeof *S.en); S.ne--; }

/* Vuelve a salir por delante del jugador, fuera de su vista (G.Spawner.ahead, simplificado). false: no hay sitio.
 * ponytail: sin el anillo de salida de Spawner ni la arena (fase 5). */
static bool enemy_ahead(Enemy *e, const Player *p) {
  const double sp = js_hypot(p->vx, p->vy);
  const double base = sp > 20 ? atan2(p->vy, p->vx) : rng_range(&S.rng, 0, 2 * PI);
  for (int t = 0; t < 8; t++) {
    const double a = base + rng_range(&S.rng, -0.7, 0.7), d = p->view + 120;
    const double x = p->x + cos(a) * d, y = p->y + sin(a) * d;
    if (e->flying || world_is_free(x, y, e->r, false)) { e->x = x; e->y = y; e->kx = e->ky = 0; e->sideT = e->stuckT = 0; return true; }
  }
  return false;
}

void sim_step(double dt) {
  /* (los eventos no se borran aquí: los vacía quien los lee, core_events; así llegan también los de fuera del paso,
   *  como la esfera usada de orb_use, que el JS pide antes de core_step) */
  S.time += dt;
  for (int i = 0; i < S.np; i++) if (S.pl[i].on) player_update(&S.pl[i], dt);
  for (int i = 0; i < S.np; i++) {   /* caído: un compañero a tu lado te va levantando (3 s) */
    Player *p = &S.pl[i];
    if (!p->on || !p->dead) continue;
    bool helper = false;
    for (int k = 0; k < S.np; k++) helper |= k != i && S.pl[k].on && !S.pl[k].dead && u_dist2(S.pl[k].x, S.pl[k].y, p->x, p->y) < 56 * 56;
    p->reviveT = helper ? p->reviveT + dt : fmax(0, p->reviveT - dt * 0.5);
    if (p->reviveT >= 3) { p->dead = false; p->hp = fmax(1, p->maxHp * 0.5); p->invuln = 2; p->reviveT = 0; sim_event(EV_PREVIVE, i, 0, p->x, p->y, 0, 0, 0); }
  }
  path_update(dt);
  for (int i = 0; i < S.np; i++) {   /* velocidad suavizada de cada jugador */
    Player *p = &S.pl[i];
    if (p->moved && dt > 0) {
      const double k = fmin(1, dt * 5);
      p->vx += ((p->x - p->px) / dt - p->vx) * k; p->vy += ((p->y - p->py) / dt - p->vy) * k;
      if (fabs(p->x - p->px) > 200 || fabs(p->y - p->py) > 200) p->vx = p->vy = 0;
    } else p->vx = p->vy = 0;
    p->px = p->x; p->py = p->y; p->moved = true;
  }
  if (!S.np) return;
  enemy_grid();
  for (int i = 0; i < S.ne; i++) { const int pi = sim_nearest_player(S.en[i].x, S.en[i].y); enemy_update(&S.en[i], pi < 0 ? 0 : pi, dt); }
  enemy_separate(dt);
  const double LAG_T = 2.5;
  for (int i = S.ne - 1; i >= 0; i--) {
    Enemy *e = &S.en[i];
    if (e->dead) { remove_enemy(i); continue; }   /* (su muerte ya salió en los eventos: EV_KILL) */
    const int pi = sim_nearest_player(e->x, e->y);
    const Player *near = &S.pl[pi < 0 ? 0 : pi];
    if (e->beh == BEH_THIEF && (e->life -= dt) <= 0) { sim_event(EV_GONE, -1, e->id, e->x, e->y, 0, 0, 0); remove_enemy(i); continue; }   /* se escapa */
    if (e->boss && !e->judge) {   /* jefe lejísimos de todos: a los 4 s vuelve a salir cerca, fuera de la vista */
      const double bf = fmax(2500, near->view + 300);
      e->lagT = u_dist2(e->x, e->y, near->x, near->y) > bf * bf ? e->lagT + dt : 0;
      if (e->lagT > 4) { e->lagT = 0; enemy_ahead(e, near); }
    }
    if (e->boss || e->shiny || e->judge || S.inArena) continue;
    /* Rezagados: detrás mientras huyes y fuera de la vista de todos → vuelven a salir por delante. */
    const double d2 = u_dist2(e->x, e->y, near->x, near->y);
    bool unseen = true;
    for (int k = 0; k < S.np; k++) {
      const Player *p = &S.pl[k];
      const double R = p->view + 40;
      if (p->on && u_dist2(e->x, e->y, p->x, p->y) <= R * R) unseen = false;
    }
    const double sp = js_hypot(near->vx, near->vy), far = fmax(1400, near->view + 300);
    const bool behind = sp > 40 && ((e->x - near->x) * near->vx + (e->y - near->y) * near->vy) < -0.2 * sqrt(d2) * sp;
    if (unseen && behind) e->lagT += dt;
    else if (!unseen) e->lagT = 0;
    if ((unseen && e->lagT > LAG_T) || d2 > far * far) {
      e->lagT = 0;
      if (!enemy_ahead(e, near)) remove_enemy(i);
    }
  }
  enemy_grid();
  for (int i = 0; i < S.np; i++) if (S.pl[i].on) combat_tick(&S.pl[i], dt);
  proj_update(dt);
  combat_resolve(dt);
  combat_fields(dt);
  pickup_update(dt);
  hazards_update(dt);
  interact_update(dt);
  weather_chip(dt);
  /* G.Game.maybeLevelUp: una carta por nivel, para todos a la vez (nunca con todos caídos) */
  bool alive = false;
  for (int i = 0; i < S.np; i++) alive |= S.pl[i].on && !S.pl[i].dead;
  if (S.pending > 0 && alive) { S.pending--; sim_event(EV_LEVEL, -1, 0, 0, 0, S.level, S.pending, 0); }
  enemy_grid();   /* para las consultas de quien llama (como rebuildGrid tras EnemyMgr.update) */
}

/* ---------------- arenas (la grieta, la Sentencia): los enemigos del mapa esperan fuera ---------------- */
static Enemy stashed[MAXEN];
static int nstashed = -1;
void sim_stash(void) {   /* EnemyMgr.stash */
  nstashed = 0;
  for (int i = 0; i < S.ne; i++) if (!S.en[i].dead) stashed[nstashed++] = S.en[i];
  S.ne = 0;
}
void sim_restore(void) {   /* EnemyMgr.restore: fuera los de la arena, vuelven los del mapa (con su id) */
  if (nstashed < 0) return;
  memcpy(S.en, stashed, (size_t)nstashed * sizeof *S.en);
  S.ne = nstashed; nstashed = -1;
  enemy_grid();
}
void sim_clear(int what) {
  if (what & 1) S.npr = 0;
  if (what & 2) S.nfi = 0;
  if (what & 4) S.nhz = 0;
  if (what & 8) S.npu = 0;
}

void sim_reset(int32_t seed) {
  memset(&S, 0, sizeof S);
  nstashed = -1;
  rng_seed(&S.rng, (uint64_t)(uint32_t)seed);
  S.level = 1; S.xpNext = xp_for(1);
  world_reset(seed);
  for (int i = 0; i < MAXPL; i++) fields[i].on = false;
  path_timer = 0;
  ngused = 0;
  for (int i = 0; i < GB; i++) grid[i].used = false;
}

size_t sim_pack_len(void) { return 9 + (size_t)S.np * SIM_PL + (size_t)S.ne * SIM_EN + (size_t)S.npr * SIM_PR + (size_t)S.nfi * SIM_FI + (size_t)S.npu * SIM_PU + 1 + (size_t)S.nhz * SIM_HZ; }
void sim_pack(double *o) {
  *o++ = S.np; *o++ = S.ne; *o++ = S.npr; *o++ = S.nfi; *o++ = S.npu; *o++ = S.level; *o++ = S.xp; *o++ = S.xpNext; *o++ = S.pending;
  for (int i = 0; i < S.np; i++) {
    const Player *p = &S.pl[i];
    *o++ = p->x; *o++ = p->y; *o++ = p->aim; *o++ = p->moveAngle; *o++ = p->walking; *o++ = p->inLiquid; *o++ = !p->dead;
    *o++ = p->hp; *o++ = p->maxHp; *o++ = p->invuln; *o++ = p->active; *o++ = p->coins; *o++ = p->t1; *o++ = p->t10; *o++ = p->kills;
    *o++ = p->item;
    for (int k = 0; k < ORB_SLOTS; k++) { *o++ = p->orbId[k]; *o++ = p->orbN[k]; }
    *o++ = p->orbCd; *o++ = p->orbT[ORB_FOCUS]; *o++ = p->orbT[ORB_LUMINOUS]; *o++ = p->orbT[ORB_QUICK];
    *o++ = p->power; *o++ = p->powerT; *o++ = p->candy;
    for (int k = 0; k < BF_N; k++) *o++ = p->bn[k];
    *o++ = p->reviveT;
  }
  for (int i = 0; i < S.ne; i++) {
    const Enemy *e = &S.en[i];
    *o++ = e->id; *o++ = e->dex; *o++ = e->x; *o++ = e->y; *o++ = e->vx; *o++ = e->vy; *o++ = e->phase; *o++ = e->dead;
    *o++ = e->hp; *o++ = e->maxHp;
    *o++ = e->shield; *o++ = e->jumpLift; *o++ = e->fury; *o++ = e->sleepT > 0; *o++ = e->stunT > 0; *o++ = e->burn > 0; *o++ = e->poison > 0;
  }
  for (int i = 0; i < S.npr; i++) {
    const Proj *p = &S.pr[i];
    *o++ = p->id; *o++ = p->owner; *o++ = p->move; *o++ = p->x; *o++ = p->y; *o++ = p->vx; *o++ = p->vy; *o++ = p->r;
    *o++ = p->friendly; *o++ = p->orb;
  }
  for (int i = 0; i < S.nfi; i++) {
    const Field *f = &S.fi[i];
    const int mv = f->owner < S.np && f->mv < S.pl[f->owner].nmv ? S.pl[f->owner].mv[f->mv].def : -1;
    *o++ = f->id; *o++ = f->kind; *o++ = f->owner; *o++ = mv; *o++ = f->x; *o++ = f->y; *o++ = f->r; *o++ = f->t;
    *o++ = f->kind == FK_METEOR ? f->fall : f->kind == FK_STUNZONE ? f->delay : f->kind == FK_CHARGE ? f->at : f->life;
  }
  for (int i = 0; i < S.npu; i++) { const Pickup *p = &S.pu[i]; *o++ = p->id; *o++ = p->kind; *o++ = p->x; *o++ = p->y; *o++ = p->t; *o++ = p->value; }
  *o++ = S.nhz;
  for (int i = 0; i < S.nhz; i++) {
    const Hazard *h = &S.hz[i];
    *o++ = h->id; *o++ = h->kind; *o++ = h->x; *o++ = h->y; *o++ = h->r; *o++ = h->angle; *o++ = h->len; *o++ = h->w; *o++ = h->t;
    *o++ = h->delay; *o++ = h->hit; *o++ = h->type; *o++ = h->boom | h->vis << 1;
  }
}

