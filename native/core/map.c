/* map.c — lo que hay en el mapa (G.Interact: altares, manantiales, cofre con candado, trampas), el daño de la arena y
 * la nieve (G.Weather.update) y los caramelos de Halloween (G.Halloween.takeCandy). Para N jugadores: cada uno usa los
 * altares y manantiales, cualquiera abre el cofre o pisa la trampa, y las trampas y el clima les dañan a todos.
 * Mismas cuentas que js/app.js (banco: bench-map.cjs).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include "core.h"
#include <math.h>
#include <string.h>

#define POWER_TIME 25
#define CHEST_TIME 3.5
#define TRAP_R 74.0

void power_apply(Player *p, int sign) {   /* G.Interact.POWERS: on / off */
  switch (p->power) {
    case POW_DMG: if (sign > 0) p->atkMul *= 2; else p->atkMul /= 2; break;
    case POW_SPD: if (sign > 0) p->spdMul *= 1.45; else p->spdMul /= 1.45; break;
    case POW_MAG: if (sign > 0) p->magnet *= 4; else p->magnet /= 4; break;
    case POW_CD: if (sign > 0) p->cdMul *= 0.6; else p->cdMul /= 0.6; break;
  }
}
static void use_power(Player *p, Prop *a) {   /* Player.addPower */
  a->used = true;
  if (p->power >= 0) power_apply(p, -1);
  p->power = a->kind; p->powerT = POWER_TIME;
  power_apply(p, 1);
  sim_event(EV_POWER, (int)(p - S.pl), 0, a->x, a->y - 20, a->kind, POWER_TIME, 0);
}

static void spring(Player *p, Prop *s, double d2, double dt) {
  if (p->dead || d2 > 26 * 26 || s->charge <= 0.02 || p->hp >= p->maxHp) return;
  const double before = p->hp;
  p->hp = fmin(p->maxHp, p->hp + p->maxHp * 0.14 * dt);
  p->springAcc += p->hp - before;
  s->charge = fmax(0, s->charge - dt * 0.09);
  p->springShown -= dt;
  if (p->springShown <= 0 && p->springAcc >= 1) {
    p->springShown = 0.6;
    sim_event(EV_HEAL, (int)(p - S.pl), 1, p->x, p->y, p->springAcc, 0, 0);
    p->springAcc = 0;
  }
  if (s->charge <= 0.02) sim_event(EV_FX, (int)(p - S.pl), FX_DRY, p->x, p->y, 0, 0, 0);
}

static void trap(const Prop *t) {   /* G.Interact.trapEffect: 0 veneno, 1 pegajosa, 2 explosiva */
  const double x = t->x, y = t->y - 8;
  const int k = t->kind, lvl = S.level;
  sim_event(EV_TRAP, -1, 0, x, y, k, 0, 0);
  int in[MAXEN]; const int n = sim_query_circle(x, y, TRAP_R, in, MAXEN);
  for (int i = 0; i < n; i++) {
    Enemy *e = &S.en[in[i]];
    if (k == 0) { apply_poison(e, 5); enemy_hurt(e, 14 + lvl * 3, 0, 0, 0, -1); }
    else if (k == 1) { apply_slow(e, 0.65, 4.5); enemy_hurt(e, 4, 0, 0, 0, -1); }
    else enemy_hurt(e, 90 + lvl * 18, e->x - x, e->y - y, 220, -1);
  }
  for (int i = 0; i < S.np; i++) {   /* (Levitación y Muro Mágico: nada; Flexibilidad y parecidas: la pegajosa no frena) */
    Player *p = &S.pl[i];
    const int f = abil_flags(p);
    if (!p->on || p->dead || u_dist2(x, y, p->x, p->y) >= (TRAP_R * 0.7) * (TRAP_R * 0.7) || f & (AF_LEVITATE | AF_TRAPPROOF) || (k == 1 && f & AF_STEADY)) continue;
    p->invuln = 0;
    if (k == 0) player_hurt(p, p->maxHp * 0.1, -1, false, CAT_NONE);
    else if (k == 1) { p->slowT = 3.5; sim_event(EV_FX, i, FX_STICKY, p->x, p->y, 0, 0, 0); }
    else player_hurt(p, p->maxHp * 0.2, -1, false, CAT_NONE);
  }
}

/* G.Interact.update, para todos: cada objeto especial cerca de alguien, una vez por paso. ponytail: tras romper uno
 * (trampa, cofre) se deja el resto para el paso siguiente (los demás del trozo cambian de sitio en la lista). */
void interact_update(double dt) {
  Prop *sp[256]; int n = 0;
  for (int i = 0; i < S.np; i++) {
    if (!S.pl[i].on) continue;
    Prop *near[256]; const int m = world_specials_near(S.pl[i].x, S.pl[i].y, 720, near, 256);
    for (int k = 0; k < m; k++) {
      bool seen = false;
      for (int j = 0; j < n && !seen; j++) seen = sp[j] == near[k];
      if (!seen && n < 256) sp[n++] = near[k];
    }
  }
  for (int j = 0; j < n; j++) {
    Prop *s = sp[j];
    switch (s->type) {
      case PROP_SPRING:
        if (s->charge < 1) s->charge = fmin(1, s->charge + dt / 45);
        for (int i = 0; i < S.np; i++) if (S.pl[i].on) spring(&S.pl[i], s, u_dist2(S.pl[i].x, S.pl[i].y, s->x, s->y - 8), dt);
        break;
      case PROP_ALTAR:   /* (contando el tamaño de su Pokémon: uno grande choca con el altar antes de llegar a 30) */
        for (int i = 0; i < S.np && !s->used; i++) {
          Player *p = &S.pl[i];
          const double k = fmax(30, s->r + p->r + 14);
          if (p->on && !p->dead && u_dist2(p->x, p->y, s->x, s->y) < k * k) use_power(p, s);
        }
        break;
      case PROP_BIGCHEST: {
        bool near = false;
        for (int i = 0; i < S.np; i++) {
          const Player *p = &S.pl[i];
          const double k = fmax(46, s->r + p->r + 24);
          near |= p->on && !p->dead && u_dist2(p->x, p->y, s->x, s->y) < k * k;
        }
        if (near) {
          s->open += dt;
          if (s->open >= CHEST_TIME) {
            Prop gone;
            s->open = 0;
            world_remove_prop(s, &gone);
            sim_event(EV_PROP, -1, gone.type, gone.x, gone.y, gone.kind, gone.tx, gone.ty);
            pickup_prop_loot(&gone);
            return;
          }
        } else if (s->open > 0) s->open = fmax(0, s->open - dt * 1.5);
        break;
      }
      case PROP_TRAP: {
        bool step = false;
        for (int i = 0; i < S.np; i++) step |= S.pl[i].on && !S.pl[i].dead && u_dist2(S.pl[i].x, S.pl[i].y, s->x, s->y - 8) < 13 * 13;
        if (!step) {
          int in[MAXEN]; const int m = sim_query_circle(s->x, s->y - 8, 3, in, MAXEN);
          for (int k = 0; k < m && !step; k++) step = !S.en[in[k]].flying;
        }
        if (step) {
          Prop gone;
          world_remove_prop(s, &gone);
          sim_event(EV_PROP, -1, gone.type, gone.x, gone.y, gone.kind, gone.tx, gone.ty);
          trap(&gone);
          return;
        }
        break;
      }
    }
  }
}

/* G.Weather.update: arena y nieve van quitando un poco de vida (a los jugadores nunca les dejan KO). */
static bool wx_hurts(uint32_t types) {
  const uint32_t safe = S.wx == WX_SAND ? 1u << TY_ROCK | 1u << TY_GROUND | 1u << TY_STEEL : S.wx == WX_SNOW ? 1u << TY_ICE : 0;
  return safe && !(types & safe);
}
void weather_chip(double dt) {
  S.chipT -= dt;
  if (S.chipT > 0) return;
  S.chipT = 2;
  if (S.wxLv <= 0.5) return;
  for (int i = 0; i < S.np; i++) {
    Player *p = &S.pl[i];
    if (!p->on || p->dead || !wx_hurts(p->types)) continue;
    const double d = fmax(1, p->maxHp * 0.012);
    if (p->hp > d + 1) { p->hp -= d; sim_event(EV_FX, i, FX_CHIP, p->x, p->y, d, S.wx, 0); }
  }
  for (int i = 0; i < S.ne; i++) {
    Enemy *e = &S.en[i];
    if (e->dead || e->boss || !wx_hurts(e->types)) continue;
    e->hp -= e->maxHp * 0.02 + 1;
    if (e->hp <= 0) enemy_kill(e);
  }
}

/* G.Halloween.takeCandy: como mucho 1,25 caramelos por minuto aguantado (no por lo que derrotas). */
bool candy_take(double need) {
  if (!world_halloween_run()) return false;
  if (floor(S.time / 60 * 1.25) - S.candyDropped < need) return false;
  S.candyDropped++;
  return true;
}
