/* foe.c — lo que hace cada personalidad de enemigo (Enemy.special, castShields, startJump, startFuse), los jefes
 * (Enemy.bossInit / bossMove / bossStart / bossCast: 4 ataques, alternar cerca / lejos, furia) y las zonas y rayos con
 * aviso (G.Hazards), que golpean a todos los jugadores que pillen. Mismas cuentas que js/app.js (banco: bench-foe.cjs).
 * Invocar lo hace el JS (EV_SUMMON: crea los esbirros con los datos de la run y los da al núcleo).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include "core.h"
#include <math.h>
#include <string.h>

#define PI 3.141592653589793
static inline double rnd(double a, double b) { return a + rng_next(&S.rng) * (b - a); }   /* G.U.rand */
static inline void anim(const Enemy *e, int a, double speed) { sim_event(EV_EANIM, -1, e->id, e->x, e->y, a, speed, 0); }
enum { A_CHARGE, A_ATTACK, A_SHOOT };
static double shot_dmg(const Enemy *e) { return e->shotDmg; }   /* (def.shotDmg × dmg / def.dmg: lo calcula quien lo crea) */

/* ---------------- avisos (G.Hazards) ---------------- */

int hazard_add(const Hazard *h) {
  if (S.nhz >= MAXHZ) return 0;
  Hazard *o = &S.hz[S.nhz++];
  *o = *h;
  o->id = ++S.next_hz; o->t = 0; o->hit = false;
  if (!o->end) o->end = 0.3;
  return o->id;
}
static void hz(const Enemy *e, int kind, double x, double y, double r, double angle, double len, double w, double delay, double dmg, bool boom) {
  hazard_add(&(Hazard){ .kind = kind, .x = x, .y = y, .r = r, .angle = angle, .len = len, .w = w, .delay = delay, .dmg = dmg,
                        .type = e->atkType, .cat = e->cat, .boom = boom });
}
static bool inside(const Hazard *h, double x, double y, double r) {
  if (h->kind == HZ_ZONE) { const double k = h->r + r * 0.6; return u_dist2(x, y, h->x, h->y) < k * k; }
  const double ca = cos(h->angle), sa = sin(h->angle), px = x - h->x, py = y - h->y, along = px * ca + py * sa;
  if (along < -r || along > h->len + r) return false;
  return fabs(-px * sa + py * ca) <= h->w / 2 + r * 0.6;
}
void hazards_update(double dt) {
  for (int i = S.nhz - 1; i >= 0; i--) {
    Hazard *h = &S.hz[i];
    h->t += dt;
    if (!h->hit && h->t >= h->delay) {
      h->hit = true;
      sim_event(EV_HAZARD, -1, h->id, h->x, h->y, h->kind, h->type, h->boom);
      for (int k = 0; k < S.np; k++) {   /* (en el JS, a su jugador cada copia; aquí, a todos los que pille) */
        Player *p = &S.pl[k];
        if (!p->on || p->dead || !inside(h, p->x, p->y, p->r) || (h->boom && abil_flags(p) & AF_DAMP)) continue;
        p->invuln = 0;
        player_hurt(p, h->pct ? fmax(h->dmg, p->maxHp * h->pct) : h->dmg, h->type, h->pure, h->cat);
      }
    }
    if (h->hit && h->t >= h->delay + h->end) { memmove(&S.hz[i], &S.hz[i + 1], (size_t)(S.nhz - i - 1) * sizeof *S.hz); S.nhz--; }
  }
}

/* ---------------- personalidades ---------------- */

/* Disparo enemigo (Enemy.shoot): n proyectiles abiertos en `spread`. */
void enemy_shoot(const Enemy *e, double ax, double ay, double spread, int n, double k) {
  const double sp = 190, base = atan2(ay, ax);
  for (int i = 0; i < n && S.npr < MAXPR; i++) {
    const double a = base + (n == 1 ? 0 : ((double)i / (n - 1) - 0.5) * spread);
    Proj *p = &S.pr[S.npr++];
    *p = (Proj){ .id = ++S.next_pr, .owner = -1, .move = -1, .src = -1, .x = e->x, .y = e->y, .vx = cos(a) * sp, .vy = sin(a) * sp,
                 .dmg = shot_dmg(e) * k, .r = 7, .life = 2.4, .mtype = e->atkType, .mcat = e->cat, .rehit = 0.34 };
  }
  sim_event(EV_SHOT, -1, e->id, e->x, e->y, base, n, e->atkType);
}

void foe_special(Enemy *e, const Player *pl, double dx, double dy) {
  switch (e->beh) {
    case BEH_FAN: { const int n = (int)e->fanN; enemy_shoot(e, dx, dy, n == 3 ? 0.6 : 0.9, n, 0.65); break; }
    case BEH_BEAMER:   /* rayo con aviso: primero se ve la franja en el suelo */
      hz(e, HZ_BEAM, e->x, e->y, 0, atan2(dy, dx), 360, 22, 1.0, shot_dmg(e) * 1.05, false);
      anim(e, A_CHARGE, 1.2);
      break;
    case BEH_ZONER: {
      const int n = rng_int(&S.rng, 1, e->zones ? e->zones : 3);
      for (int i = 0; i < n; i++) {
        const double x = pl->x + (i ? rnd(-70, 70) : 0), y = pl->y + (i ? rnd(-55, 55) : 0);
        hz(e, HZ_ZONE, x, y, 44, 0, 0, 0, 1.2, shot_dmg(e) * 0.95, false);
      }
      anim(e, A_SHOOT, 1);
      break;
    }
    case BEH_HEALER: {   /* healAround: 7 % (más cuanto más fuerte pegáis, como mucho ×2,5) */
      double pow_ = 1;
      for (int i = 0; i < S.np; i++) {
        const Player *p = &S.pl[i];
        const double a = p->baseAtk * p->atkMul * (1 + p->bn[BF_ATK] * p->bamt[BF_ATK]);
        if (p->on && a > 0 && p->baseAtk > 0) pow_ = fmax(pow_, a / p->baseAtk);
      }
      const double k = 0.07 * fmin(2.5, pow(pow_, 0.35));
      int in[MAXEN]; const int n = sim_query_circle(e->x, e->y, 150, in, MAXEN);
      for (int i = 0; i < n; i++) {
        Enemy *o = &S.en[in[i]];
        if (o->dead || o->hp >= o->maxHp) continue;
        const double heal = o->maxHp * k;
        o->hp = fmin(o->maxHp, o->hp + (o->boss ? fmin(heal, o->rd / 6 * 0.4) : heal));
      }
      anim(e, A_CHARGE, 1);
      sim_event(EV_RING, -1, e->id, e->x, e->y, 8, 150, 4);
      break;
    }
    case BEH_SUMMONER: sim_event(EV_SUMMON, -1, e->id, e->x, e->y, 0, 0, 0); break;
    default: enemy_shoot(e, dx, dy, 0, 1, 1);
  }
}

static void shields(Enemy *e) {   /* castShields: a los 6 más cercanos (a 160) */
  int in[MAXEN]; const int n0 = sim_query_circle(e->x, e->y, 160, in, MAXEN);
  int near[MAXEN], n = 0;
  for (int i = 0; i < n0; i++) if (!S.en[in[i]].dead) near[n++] = in[i];
  for (int i = 1; i < n; i++) {   /* por distancia (estable, como sort) */
    const int v = near[i]; const double d = u_dist2(S.en[v].x, S.en[v].y, e->x, e->y);
    int j = i - 1;
    while (j >= 0 && u_dist2(S.en[near[j]].x, S.en[near[j]].y, e->x, e->y) > d) { near[j + 1] = near[j]; j--; }
    near[j + 1] = v;
  }
  for (int i = 0; i < n && i < 6; i++) {
    Enemy *o = &S.en[near[i]];
    if (o->boss && o->shieldT > 2) continue;
    const double s = o->boss ? fmin(o->maxHp * 0.35, o->rd / 6 * 1.2) : o->maxHp * 0.35;
    o->shield = fmax(o->shield, s); o->shieldT = 8;
  }
  anim(e, A_CHARGE, 1);
  sim_event(EV_RING, -1, e->id, e->x, e->y, 8, 160, 5);
}

static void jump_to(Enemy *e, double tx, double ty, double t0, double dur) {
  e->jumping = true; e->jsx = e->x; e->jsy = e->y; e->jtx = tx; e->jty = ty; e->jt = t0; e->jdur = dur;
}
static void jump_update(Enemy *e, double dt) {   /* se agacha, vuela en arco y cae donde estabas */
  e->jt += dt;
  if (e->jt < 0) return;
  const double k = fmin(1, e->jt / e->jdur);
  e->x = e->jsx + (e->jtx - e->jsx) * k;
  e->y = e->jsy + (e->jty - e->jsy) * k;
  e->jumpLift = sin(k * PI) * 46;
  if (k >= 1) {
    e->jumping = false; e->jumpLift = 0;
    if (!e->flying) world_collide(&e->x, &e->y, e->r);
    anim(e, A_ATTACK, 1.4);
  }
}

bool foe_skills(Enemy *e, const Player *pl, double dist, double dt) {
  if (e->shieldT > 0 && (e->shieldT -= dt) <= 0) e->shield = 0;
  if (e->jumping) { jump_update(e, dt); return true; }
  if (e->beh == BEH_BOMBER && e->phase == PH_FUSE) {
    e->pt -= dt;
    if (e->pt <= 0) { e->hp = 0; enemy_kill(e); }
    return true;
  }
  if (e->beh == BEH_BOMBER && dist < e->r + pl->r + 26) {   /* startFuse */
    e->phase = PH_FUSE; e->pt = 1.0;
    hazard_add(&(Hazard){ .kind = HZ_ZONE, .x = e->x, .y = e->y, .r = 62, .delay = 1.0, .dmg = e->dmg * 1.4, .type = e->atkType,
                          .cat = e->cat, .boom = true });
    return true;
  }
  if (e->beh == BEH_SHIELDER || e->beh == BEH_JUMPER) {
    e->skillCd -= dt;
    if (e->skillCd <= 0) {
      if (e->beh == BEH_SHIELDER) { e->skillCd = 6; shields(e); }
      else if (dist < 250) {   /* startJump */
        e->skillCd = rnd(5, 7);
        jump_to(e, pl->x, pl->y, -0.45, 0.6);
        anim(e, A_CHARGE, 1.4);
        hz(e, HZ_ZONE, pl->x, pl->y, 50, 0, 0, 0, 1.05, e->dmg * 1.2, false);
        return true;
      } else e->skillCd = 0.5;
    }
  }
  return false;
}

/* ---------------- jefes ---------------- */

static void boss_init(Enemy *e) {
  const uint32_t T = e->types;
  const bool fire = T & (1u << TY_FIRE | 1u << TY_GROUND | 1u << TY_POISON | 1u << TY_ROCK | 1u << TY_GRASS);
  const bool beam = T & (1u << TY_ELECTRIC | 1u << TY_PSYCHIC | 1u << TY_DRAGON | 1u << TY_ICE | 1u << TY_STEEL);
  const bool nova = T & (1u << TY_FAIRY | 1u << TY_GHOST | 1u << TY_WATER | 1u << TY_FLYING);
  e->aiMelee[0] = BA_SLAM; e->aiMelee[1] = core_hash(e->dex, 3, 7) < 0.5 ? BA_DASH : BA_LEAP;
  const int pref = fire ? BA_RAIN : beam ? BA_BEAM : nova ? BA_NOVA : BA_VOLLEY;
  int others[3], n = 0;
  for (int id = BA_RAIN; id <= BA_VOLLEY; id++) if (id != pref) others[n++] = id;   /* (rain, beam, nova, volley) */
  e->aiRanged[0] = pref; e->aiRanged[1] = others[(int)floor(core_hash(e->dex, 5, 9) * 3) % 3];
  const bool far = e->beh == BEH_RANGED;
  e->farLike = far ? 0.65 : 0.35; e->aiFar = far; e->modeT = rnd(6, 8);
  e->aiCd = 1.6; e->cast = BA_NONE; e->fury = false; e->aiSide = rng_next(&S.rng) < 0.5 ? -1 : 1;
  e->aiOn = true;
}
/* (rain, beam, nova, volley en el orden de la lista de JS: ['rain', 'beam', 'nova', 'volley']) */
static void boss_end(Enemy *e) {
  e->cast = BA_NONE;
  e->aiCd = rnd(1.3, 2.0);
  if (e->fury && rng_next(&S.rng) < 0.35) e->aiCd = 0.3;   /* encadena otro */
}
static void boss_start(Enemy *e, int id, const Player *pl) {
  const double f = e->fury ? 0.8 : 1, ang = atan2(pl->y - e->y, pl->x - e->x);
  e->cast = id; e->ct = 0; e->cwind = 0.6 * f; e->cafter = 0.35; e->cang = ang; e->cgo = e->cfired = false;
  switch (id) {
    case BA_SLAM:   /* pisotón: onda alrededor */
      e->cwind = 0.85 * f;
      hz(e, HZ_ZONE, e->x, e->y, 96 + e->r, 0, 0, 0, e->cwind, e->dmg * 1.3, false);
      anim(e, A_CHARGE, 1.2);
      break;
    case BA_DASH:   /* embestida en línea recta */
      e->cwind = 0.75 * f; e->clen = 330; e->cdur = 0.32;
      hz(e, HZ_BEAM, e->x, e->y, 0, ang, e->clen + e->r, e->r * 2 + 16, e->cwind + e->cdur, e->dmg * 1.2, false);
      anim(e, A_CHARGE, 1.3);
      break;
    case BA_LEAP:   /* salto y caída sobre ti */
      jump_to(e, pl->x, pl->y, -0.5 * f, 0.65);
      hz(e, HZ_ZONE, pl->x, pl->y, 82, 0, 0, 0, 0.5 * f + 0.65, e->dmg * 1.25, false);
      anim(e, A_CHARGE, 1.4);
      e->cast = BA_NONE; e->aiCd = rnd(1.4, 2) + 0.6;
      break;
    case BA_RAIN: {   /* zonas que caen alrededor de ti */
      const int n = e->fury ? 6 : 4;
      for (int i = 0; i < n; i++) {
        const double a = i ? rng_next(&S.rng) * 6.2832 : 0, d = i ? rnd(40, 120) : 0;
        hz(e, HZ_ZONE, pl->x + cos(a) * d, pl->y + sin(a) * d * 0.8, 50, 0, 0, 0, 1.05 + i * 0.12, shot_dmg(e) * 1.15, false);
      }
      e->cwind = 0.5; anim(e, A_SHOOT, 1);
      break;
    }
    case BA_BEAM: {   /* rayos en abanico */
      const int n = e->fury ? 5 : 3; const double sp = e->fury ? 0.42 : 0.5;
      for (int i = 0; i < n; i++) hz(e, HZ_BEAM, e->x, e->y, 0, ang + (i - (n - 1) / 2.0) * sp, 400, 26, 1.0, shot_dmg(e) * 1.2, false);
      e->cwind = 1.0; e->cafter = 0.25; anim(e, A_CHARGE, 1.1);
      break;
    }
    case BA_VOLLEY: case BA_NOVA:   /* abanico / anillo de disparos */
      e->cwind = (id == BA_NOVA ? 0.7 : 0.5) * f;
      anim(e, A_CHARGE, 1.4);
      sim_event(EV_RING, -1, e->id, e->x, e->y, e->r, e->r * 2.4, 6);
      break;
  }
}
static void boss_cast(Enemy *e, const Player *pl, double dt, double *vx, double *vy) {
  e->ct += dt;
  *vx = *vy = 0;
  if (e->cast == BA_DASH && e->ct >= e->cwind) {
    if (!e->cgo) { e->cgo = true; anim(e, A_ATTACK, 1.6); }
    if (e->ct >= e->cwind + e->cdur) { boss_end(e); return; }
    const double sp = e->clen / e->cdur;
    *vx = cos(e->cang) * sp; *vy = sin(e->cang) * sp;
    return;
  }
  if (e->ct >= e->cwind && !e->cfired) {
    e->cfired = true;
    double ax, ay;
    u_norm(pl->x - e->x, pl->y - e->y, &ax, &ay);
    if (e->cast == BA_VOLLEY) enemy_shoot(e, ax, ay, 1.1, e->fury ? 9 : 7, 0.8);
    else if (e->cast == BA_NOVA) { const int n = e->fury ? 18 : 14; enemy_shoot(e, ax, ay, 6.2832 * (n - 1) / n, n, 0.7); }
    else if (e->cast == BA_SLAM) anim(e, A_ATTACK, 1.4);
  }
  if (e->ct >= e->cwind + e->cafter) boss_end(e);
}

void foe_boss_move(Enemy *e, const Player *pl, double dt, double dist, double dx, double dy, double spd, double *vx, double *vy) {
  if (!e->aiOn) boss_init(e);
  if (!e->fury && e->hp < e->maxHp * 0.5) {   /* enrage */
    e->fury = true; e->spd *= 1.15;
    sim_event(EV_ENRAGE, -1, e->id, e->x, e->y, e->r, 0, 0);
  }
  const double k = e->fury ? 1.25 : 1;
  if (e->cast != BA_NONE) { boss_cast(e, pl, dt, vx, vy); return; }
  e->modeT -= dt; e->aiCd -= dt * k;
  if (e->modeT <= 0) {   /* alterna: en su distancia favorita está más rato */
    e->aiFar = !e->aiFar;
    e->modeT = e->aiFar == (e->farLike > 0.5) ? rnd(7, 9) : rnd(4, 5);
    e->aiSide = -e->aiSide;
  }
  *vx = dx * spd * k * 1.1; *vy = dy * spd * k * 1.1;
  double ddx, ddy;
  u_norm(pl->x - e->x, pl->y - e->y, &ddx, &ddy);
  if (e->aiFar) {
    if (dist < 170) { *vx = -ddx * spd; *vy = -ddy * spd; }
    else if (dist < 300) { *vx = -ddy * spd * 0.55 * e->aiSide; *vy = ddx * spd * 0.55 * e->aiSide; }   /* te rodea */
  }
  if (e->aiCd <= 0) {
    int id = BA_NONE;
    if (!e->aiFar) {
      int ok[2], n = 0;
      for (int i = 0; i < 2; i++) if (e->aiMelee[i] == BA_SLAM ? dist < 125 : dist < 320) ok[n++] = e->aiMelee[i];
      if (n && rng_next(&S.rng) < 0.8) id = ok[rng_int(&S.rng, 0, n - 1)];
      else if (dist < 480) id = e->aiRanged[rng_int(&S.rng, 0, 1)];
    } else id = dist < 115 ? BA_SLAM : dist < 430 ? e->aiRanged[rng_int(&S.rng, 0, 1)] : BA_NONE;
    if (id != BA_NONE) boss_start(e, id, pl);
  }
}
