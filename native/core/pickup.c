/* pickup.c — lo que hay en el suelo: G.Pickups (L13602), el botín de los enemigos y de los objetos del escenario
 * (Enemy.die, World.destroyProp) y lo que hace cada cosa al recogerla (G.Game.onCollect), para N jugadores. La
 * experiencia es del equipo (como el cooperativo: todos suben de nivel a la vez y cada uno elige su carta).
 * Mismo orden de cuentas que js/app.js (banco: bench-pickup.cjs).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include "core.h"
#include <math.h>
#include <string.h>

static inline double rnd(double a, double b) { return a + rng_next(&S.rng) * (b - a); }   /* G.U.rand */
static inline int rnd_int(int a, int b) { return (int)floor(a + rng_next(&S.rng) * (b - a + 1)); }   /* G.U.randInt */
static inline double damp(double a, double b, double rate, double dt) { return b + (a - b) * exp(-rate * dt); }

double xp_for(int level) { return floor((8 + level * 6 + pow(level, 1.75) * 1.6) * 4); }

static void push(Pickup o) {
  o.id = ++S.next_pu;
  S.pu[S.npu++] = o;
  if (S.npu <= MAXPU) return;
  /* junta los dos de experiencia más viejos para no crecer sin límite */
  int i = -1;
  for (int k = 0; k < S.npu && i < 0; k++) if (S.pu[k].kind == PK_XP || S.pu[k].kind == PK_XPBIG) i = k;
  if (i >= 0) {
    const Pickup a = S.pu[i];
    memmove(&S.pu[i], &S.pu[i + 1], (size_t)(S.npu - i - 1) * sizeof *S.pu); S.npu--;
    for (int k = 0; k < S.npu; k++) if (S.pu[k].kind == PK_XP || S.pu[k].kind == PK_XPBIG) { S.pu[k].value += a.value; S.pu[k].kind = PK_XPBIG; break; }
  } else { memmove(&S.pu[0], &S.pu[1], (size_t)(S.npu - 1) * sizeof *S.pu); S.npu--; }
}
static Pickup orb(int kind, double x, double y, double value) {   /* sale con un pequeño empujón */
  /* cuál: G.Items.roll() / G.Orbs.roll() (en el JS, antes de soltarlo) */
  if (kind == PK_ITEM) value = rng_int(&S.rng, 0, IT_N - 1);
  else if (kind == PK_SPHERE) value = rng_int(&S.rng, 0, ORB_N - 1);
  const double a = rng_next(&S.rng) * 6.2832;
  Pickup o = { .kind = kind, .x = x, .y = y, .value = value };
  o.vx = cos(a) * rnd(10, 46); o.vy = sin(a) * rnd(10, 46);
  o.t = rng_next(&S.rng) * 6.28;
  return o;
}
void pickup_drop(int kind, double x, double y, double value) { push(orb(kind, x, y, value)); }

void pickup_drop_xp(double x, double y, double value, bool boss, bool legend, bool plain) {
  if (boss) {   /* un montón de orbes grandes y recompensas */
    for (int i = 0; i < 14; i++) {
      const double a = rng_next(&S.rng) * 6.2832, d = rnd(10, 70);
      push(orb(PK_XPBIG, x + cos(a) * d, y + sin(a) * d, ceil(value / 14)));
    }
    if (plain) return;
    push(orb(PK_HEAL, x + 24, y, 0));
    push(orb(PK_MAGNET, x - 24, y, 0));
    if (rng_next(&S.rng) < (legend ? 1.0 / 2 : 1.0 / 3)) push(orb(PK_TICKET10, x, y - 20, 1));
    push(orb(PK_SPHERE, x - 20, y - 16, 0));
    if (legend) push(orb(PK_SPHERE, x + 20, y - 16, 0));
    return;
  }
  push(orb(value >= 20 ? PK_XPBIG : PK_XP, x, y, value));
  if (rng_next(&S.rng) < 1.0 / 400) push(orb(PK_TICKET, x + rnd(-6, 6), y, 1));
  if (rng_next(&S.rng) < 1.0 / 300) push(orb(PK_SPHERE, x + rnd(-6, 6), y, 0));
  const double r = rng_next(&S.rng);
  if (r < 0.012) push(orb(PK_HEAL, x + rnd(-8, 8), y, 0));
  else if (r < 0.020) push(orb(PK_MAGNET, x, y, 0));
  else if (r < 0.026) push(orb(PK_BOMB, x, y, 0));
}

/* G.Game.levelXp: lo que falta para el siguiente nivel (el cofre con candado lo da). */
static double level_xp(void) {
  const double k = S.np ? S.pl[0].xpMul : 1;
  return ceil((S.xpNext - S.xp + 1) / (k ? k : 1));
}

void pickup_prop_loot(const Prop *p) {   /* World.destroyProp */
  switch (p->type) {
    case PROP_GRASS: { const double r = rng_next(&S.rng); if (r < 0.05) pickup_drop(PK_HEAL, p->x, p->y, 0); else if (r < 0.11) pickup_drop(PK_COIN, p->x, p->y, 1); break; }
    case PROP_ROCK: {
      const double r = rng_next(&S.rng);
      if (r < 0.40) pickup_drop_xp(p->x, p->y, 6, false, false, false);
      if (r > 0.75) pickup_drop(PK_COIN, p->x, p->y, 2);
      if (r > 0.94) pickup_drop(PK_HEAL, p->x + 8, p->y, 0);
      break;
    }
    case PROP_PUMPKIN:
      pickup_drop_xp(p->x, p->y, 8, false, false, false);
      if (rng_next(&S.rng) < 0.5) pickup_drop(PK_COIN, p->x + 6, p->y, 2);
      if (candy_take(1)) pickup_drop(PK_CANDY, p->x - 6, p->y - 4, 1);
      break;
    case PROP_CHEST: {
      const int n = rnd_int(4, 7);
      for (int i = 0; i < n; i++) pickup_drop(PK_COIN, p->x + rnd(-14, 14), p->y + rnd(-10, 10), 3);
      pickup_drop(rng_next(&S.rng) < 0.5 ? PK_HEAL : PK_MAGNET, p->x, p->y, 0);
      pickup_drop_xp(p->x, p->y, 20, false, false, false);
      if (rng_next(&S.rng) < 0.08) pickup_drop(PK_ITEM, p->x, p->y - 12, 0);
      if (rng_next(&S.rng) < 0.35) pickup_drop(PK_SPHERE, p->x - 12, p->y - 12, 0);
      break;
    }
    case PROP_BIGCHEST: {
      for (int i = 0; i < 9; i++) pickup_drop(PK_COIN, p->x + rnd(-22, 22), p->y + rnd(-14, 14), 4);
      const int tk = rnd_int(1, 3);
      for (int i = 0; i < tk; i++) pickup_drop(PK_TICKET, p->x + rnd(-16, 16), p->y + rnd(-10, 10), 1);
      if (rng_next(&S.rng) < 0.15) pickup_drop(PK_TICKET10, p->x, p->y - 10, 1);
      if (rng_next(&S.rng) < 0.5) pickup_drop(PK_ITEM, p->x + 14, p->y - 14, 0);
      pickup_drop(PK_SPHERE, p->x - 14, p->y - 14, 0);
      if (rng_next(&S.rng) < 0.5) pickup_drop(PK_SPHERE, p->x, p->y - 20, 0);
      pickup_drop_xp(p->x, p->y, level_xp(), false, false, false);
      break;
    }
  }
}

/* El reparto de la experiencia en grupo (G.Coop.xpFactor): la media de los ×experiencia, partida entre la del 1, y
 * cada uno de más le quita un poco (×1 / (1 + 0,6 por compañero)). */
static double xp_factor(void) {
  if (S.np < 2) return 1;
  double s = 0; int n = 0;
  for (int i = 0; i < S.np; i++) if (S.pl[i].on) { s += S.pl[i].xpMul ? S.pl[i].xpMul : 1; n++; }
  const double me = S.pl[0].xpMul ? S.pl[0].xpMul : 1;
  return (s / n) / me / (1 + 0.6 * (n - 1));
}

static void gain_xp(double amount) {   /* Player.gainXp, con el ×experiencia del 1 (el anfitrión en el JS) */
  const double add = amount * (S.np ? S.pl[0].xpMul : 1);
  if (!isfinite(add) || add <= 0) return;
  S.xp += add;
  for (int n = 0; S.xp >= S.xpNext && n < 50; n++) {
    S.xp -= S.xpNext;
    S.level++;
    S.xpNext = xp_for(S.level);
    S.pending++;
    for (int i = 0; i < S.np; i++) S.pl[i].level = S.level;
  }
}

void pickup_collect(const Pickup *p, int who) {
  Player *pl = &S.pl[who];
  sim_event(EV_PICK, who, p->kind, pl->x, pl->y, p->value, p->x, p->y);
  switch (p->kind) {
    case PK_XP: case PK_XPBIG: gain_xp(p->value * xp_factor()); break;
    case PK_COIN: pl->coins += p->value; break;
    case PK_TICKET: pl->t1++; break;
    case PK_TICKET10: pl->t10++; break;
    case PK_SPHERE: orb_add(pl, (int)p->value); break;
    case PK_CANDY: pl->candy += p->value ? p->value : 1; break;   /* el objeto lo elige el JS (core_item) */
    case PK_HEAL: player_heal(pl, pl->maxHp * 0.3); break;
    case PK_MAGNET: for (int i = 0; i < S.npu; i++) S.pu[i].pulled = true; break;
    case PK_BOMB: {   /* todo lo que ve quien la coge (en el JS, su cámara) */
      const double R = pl->view;
      for (int i = 0; i < S.ne; i++) {
        Enemy *e = &S.en[i];
        if (u_dist2(e->x, e->y, pl->x, pl->y) > R * R) continue;
        enemy_hurt(e, 60 + pl->level * 14, e->x - pl->x, e->y - pl->y, 160, who);
      }
      break;
    }
  }
}

void pickup_update(double dt) {
  for (int i = S.npu - 1; i >= 0; i--) {
    Pickup *p = &S.pu[i];
    p->t += dt * 4;
    /* el jugador vivo más cercano (en solitario, siempre él) */
    int who = -1; double d2 = INFINITY;
    for (int k = 0; k < S.np; k++) {
      const Player *o = &S.pl[k];
      if (!o->on || (o->dead && S.np > 1)) continue;
      if (p->kind == PK_SPHERE && !orb_can_take(o, (int)p->value)) continue;   /* una esfera, sólo a quien le quepa */
      const double dd = u_dist2(o->x, o->y, p->x, p->y);
      if (dd < d2) { d2 = dd; who = k; }
    }
    if (who < 0) { p->pulled = false; p->vx *= pow(0.02, dt); p->vy *= pow(0.02, dt); p->x += p->vx * dt; p->y += p->vy * dt; continue; }
    const Player *pl = &S.pl[who];
    const double dx = pl->x - p->x, dy = pl->y - p->y, mag2 = pl->magnet * pl->magnet;
    if (p->pulled || d2 < mag2) {
      p->pulled = true;
      double d = sqrt(d2); if (!d) d = 1;
      const double pull = 240 + 1400 / d;
      p->vx = damp(p->vx, (dx / d) * pull, 7, dt);
      p->vy = damp(p->vy, (dy / d) * pull, 7, dt);
    } else {
      p->vx *= pow(0.02, dt);
      p->vy *= pow(0.02, dt);
    }
    p->x += p->vx * dt;
    p->y += p->vy * dt;
    if (d2 < 15 * 15) {
      const Pickup got = *p;
      memmove(&S.pu[i], &S.pu[i + 1], (size_t)(S.npu - i - 1) * sizeof *S.pu); S.npu--;
      pickup_collect(&got, who);
    }
  }
}
