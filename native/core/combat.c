/* combat.c — ataques y daño: G.Combat (L14920), G.Projectiles (L12384), el daño de Enemy.hurt y Player.hurt y la tabla
 * de tipos (G.Types, G.Stats), para N jugadores: todo lleva su dueño. Sin habilidades ni objetos (fase 3b), sin clima.
 * Mismo orden de cuentas que js/app.js (banco: bench-combat.cjs).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include "core.h"
#include <math.h>
#include <string.h>

#define PI 3.141592653589793
#define QSTEP 34

static inline double rnd(double a, double b) { return a + rng_next(&S.rng) * (b - a); }   /* G.U.rand */
static inline int ival(double v) { return (int)v; }                                        /* (v | 0) */

int move_find(const char *id) {
  for (int i = 0; i < core_n_moves; i++) if (!strcmp(core_moves[i].id, id)) return i;
  return -1;
}

void sim_event(int k, int who, int id, double x, double y, double a, double b, double c) {
  if (S.nev < MAXEV) S.ev[S.nev++] = (Ev){ k, who, id, x, y, a, b, c };
}

/* ================= tipos y stats ================= */

double type_mult(int atk, uint32_t def) {   /* G.Types.mult: los ×2 / ×0,5 / ×0 de los juegos, suavizados */
  if (atk < 0 || atk >= TY_N || !def) return 1;
  double m = 1;
  for (int t = 0; t < TY_N; t++) {
    if (!(def & 1u << t)) continue;
    const double v = core_type_chart[atk][t];
    if (v == 2) m *= 1.6; else if (v == 0.5) m *= 0.6; else if (v == 0) m *= 0.3;
  }
  return u_clamp(m, 0.3, 2.4);
}
static double guard(double def) { return u_clamp(pow(75 / fmax(5, def > 0 ? def : 75), 0.35), 0.78, 1.25); }
double stats_taken(const DexStat *mon, int cat) {   /* G.Stats.taken */
  if (!mon || !cat) return 1;
  const double d = cat == CAT_SPEC ? mon->sd : mon->df;
  return guard(d < 0 ? 0 : d);
}
static double stats_fit(const DexStat *mon, int cat) {
  if (!mon || !cat || mon->pa < 0) return 1;
  return (cat == CAT_SPEC ? mon->sa : mon->pa) / mon->atk;
}
static int popcount(uint32_t v) { int n = 0; while (v) { n += v & 1; v >>= 1; } return n; }

/* ================= jugador: ataque, daño, curas ================= */

static double player_atk(const Player *p) { return p->baseAtk * p->atkMul * (1 + p->bn[BF_ATK] * p->bamt[BF_ATK]); }
double player_atk_for(const Player *p, int type, int cat) {   /* Player.atkFor */
  const int b = cat == CAT_PHYS ? BF_PATK : cat == CAT_SPEC ? BF_SATK : -1;
  const bool mono = popcount(p->types) == 1 && type >= 0 && p->types == 1u << type;
  return player_atk(p) * stats_fit(p->mon, cat) * (b >= 0 ? 1 + p->bn[b] * p->bamt[b] : 1) * (mono ? 1.2 : 1);
}
static double atk_for(const Player *p, const PMove *m) { const MoveDef *d = &core_moves[m->def]; return player_atk_for(p, d->type, d->cat); }

static double reduction(const Player *p) { return fmin(0.8, p->dmgReduce + p->bn[BF_DEF] * p->bamt[BF_DEF]); }

static void clear_orbs(int owner) {
  int k = 0;
  for (int i = 0; i < S.npr; i++) if (!(S.pr[i].orb && S.pr[i].owner == owner)) S.pr[k++] = S.pr[i];
  S.npr = k;
}

bool sim_god;

void player_hurt(Player *p, double amount, int type, bool pure, int cat) {
  if (sim_god || p->invuln > 0 || p->dead) return;
  const int who = (int)(p - S.pl), cls = cat == CAT_PHYS ? 'p' : cat == CAT_SPEC ? 's' : 0;
  if (!pure) {   /* habilidad: absorber un tipo, esquivar o recibir menos */
    if (type >= 0 && abil_absorb(p) == type) { p->invuln = 0.3; player_heal(p, p->maxHp * 0.03); return; }
    if (abil_has_dodge(p) && rng_next(&S.rng) < abil_dodge(p, type, cls)) {
      p->invuln = 0.3; sim_event(EV_FX, who, FX_DODGE, p->x, p->y, 0, 0, 0); return;
    }
    amount *= abil_in(p, type, cls);
  }
  if (!pure) amount *= stats_taken(p->mon, cat);
  if (type >= 0) amount *= type_mult(type, p->types) * wx_mult(type);
  bool close = false;   /* con un cuerpo a cuerpo activo se recibe un 25 % menos */
  if (p->nslot) for (int i = 0; i < p->slotn[p->active]; i++) close |= core_moves[p->mv[p->slot[p->active][i]].def].kind == MK_MELEE;
  const double d = pure ? fmax(1, amount) : fmax(1, amount * (1 - reduction(p)) * (close ? 0.75 : 1));
  p->hp -= d;
  p->invuln = 0.45;
  sim_event(EV_PHURT, who, 0, p->x, p->y, d, type, 0);
  if (p->hp <= 0 && p->item == IT_FOCUSSASH && S.time - p->sashT > 60) {   /* Banda Focus: 1 de vida, cada 60 s */
    p->sashT = S.time; p->hp = 1; p->invuln = 1.2; sim_event(EV_FX, who, FX_SASH, p->x, p->y, 0, 0, 0);
  }
  if (p->hp <= 0 && abil_flags(p) & AF_STURDY && S.time - p->sturdyAt > 90) {   /* Robustez: lo mismo, cada 90 s */
    p->sturdyAt = S.time; p->hp = 1; p->invuln = 1.2; sim_event(EV_FX, who, FX_STURDY, p->x, p->y, 0, 0, 0);
  }
  if (p->hp > 0) abil_hurt(p, type, cls);
  if (p->hp <= 0) {
    p->hp = 0; p->dead = true; p->reviveT = 0;
    clear_orbs(who);
    sim_event(EV_PDEAD, who, 0, p->x, p->y, 0, 0, 0);
  }
}

void player_heal(Player *p, double amount) {
  amount *= abil_heal_mul(p);
  const double before = p->hp;
  p->hp = fmin(p->maxHp, p->hp + amount);
  if (p->hp - before >= 0.5) sim_event(EV_HEAL, (int)(p - S.pl), 0, p->x, p->y, p->hp - before, 0, 0);
}

void add_buff(Player *p, int stat, double amount, double dur, int max) {   /* Player.addBuff */
  const double n = fmin(max, p->bn[stat] + 1);
  if (p->bn[stat] && p->bn[stat] * p->bamt[stat] > n * amount) { p->bt[stat] = fmax(p->bt[stat], dur); return; }
  p->bamt[stat] = amount; p->bn[stat] = n; p->bt[stat] = dur;
}

bool player_learn(Player *p, int def, int lvl) {
  if (def < 0 || p->nmv >= MAXMV || p->nslot >= MAXSLOT) return false;
  for (int i = 0; i < p->nmv; i++) if (p->mv[i].def == def) return false;
  p->mv[p->nmv] = (PMove){ .def = def, .lvl = lvl < 1 ? 1 : lvl > core_moves[def].maxLvl ? core_moves[def].maxLvl : lvl };
  p->slot[p->nslot][0] = p->nmv++; p->slotn[p->nslot] = 1;
  if (!p->nslot++) p->active = 0;
  return true;
}

bool player_set_slots(Player *p, const char *s, int active) {
  int slot[MAXSLOT][MAXMV], slotn[MAXSLOT] = { 0 }, ns = 0;
  char id[64]; int n = 0;
  for (const char *c = s;; c++) {
    if (*c && *c != ',' && *c != ';') { if (n < 63) id[n++] = *c; continue; }
    if (n) {
      id[n] = 0; n = 0;
      const int d = move_find(id);
      int k = -1;
      for (int i = 0; i < p->nmv; i++) if (p->mv[i].def == d) k = i;
      if (k < 0 || ns >= MAXSLOT || slotn[ns] >= MAXMV) return false;
      slot[ns][slotn[ns]++] = k;
    }
    if ((*c == ';' || !*c) && ns < MAXSLOT && slotn[ns]) ns++;
    if (!*c) break;
  }
  if (!ns) return false;
  memcpy(p->slot, slot, sizeof slot); memcpy(p->slotn, slotn, sizeof slotn);
  p->nslot = ns;
  const int a = active >= 0 && active < ns ? active : 0;
  if (a != p->active) clear_orbs((int)(p - S.pl));
  p->active = a;
  return true;
}

void player_set_active(Player *p, int i) {
  if (i < 0 || i >= p->nslot || i == p->active) return;
  p->active = i;
  clear_orbs((int)(p - S.pl));
  for (int k = 0; k < p->slotn[i]; k++) { PMove *m = &p->mv[p->slot[i][k]]; m->t = fmin(m->t, pm_stat(m)->cd * 0.35); }
}

/* ================= enemigos: daño y estados ================= */

Enemy *sim_enemy(int id) { for (int i = 0; i < S.ne; i++) if (S.en[i].id == id) return &S.en[i]; return NULL; }

static inline double jround(double v) { return floor(v + 0.5); }   /* Math.round */

void enemy_hurt(Enemy *e, double amount, double dx, double dy, double knock, int by) {
  if (e->dead) return;
  const double d = fmax(1, jround(amount));
  if (e->arceus) { sim_event(EV_HIT, by, e->id, e->x, e->y, d, 2, 0); return; }   /* no cae: suma a su cuenta (el JS) */
  if (by >= 0) e->lastHit = by;
  if (e->boss) e->rd += d;
  if (e->shield > 0) {   /* el escudo absorbe primero */
    const double a = fmin(e->shield, d);
    e->shield -= a;
    if (a >= d) { sim_event(EV_HIT, by, e->id, e->x, e->y, d, 1, 0); return; }
    amount = d - a;
  }
  e->hp -= fmax(1, jround(amount));
  sim_event(EV_HIT, by, e->id, e->x, e->y, d, 0, 0);
  if (knock > 0 && !e->boss) {
    double nx, ny;
    u_norm(dx, dy, &nx, &ny);
    e->kx += nx * knock; e->ky += ny * knock;
  }
  if (e->hp <= 0) enemy_kill(e);
}
void enemy_kill(Enemy *e) {
  if (e->dead) return;
  {
    e->dead = true;
    const int k = e->lastHit >= 0 && e->lastHit < S.np ? e->lastHit : 0;
    if (S.np) { S.pl[k].kills++; abil_kill(&S.pl[k], e); }
    sim_event(EV_KILL, k, e->id, e->x, e->y, e->xp, e->boss, e->dex);
    /* Enemy.die: el botín (los legendarios de la Sentencia, sólo experiencia) */
    if (e->boss && !e->judge) {
      for (int i = 0; i < 10; i++) pickup_drop(PK_COIN, e->x + (rng_next(&S.rng) * 80 - 40), e->y + (rng_next(&S.rng) * 60 - 30), 5);
      pickup_drop(PK_ITEM, e->x - 26, e->y - 10, 0);
    }
    pickup_drop_xp(e->x, e->y, e->xp, e->boss, e->legend, e->judge);
    /* Halloween: caramelos al ritmo de G.Halloween (los Fantasma en cuanto toca; los demás, si se han ido acumulando) */
    if (!e->judge && candy_take(e->types & 1u << TY_GHOST ? 1 : 3)) pickup_drop(PK_CANDY, e->x + (rng_next(&S.rng) * 16 - 8), e->y - 6, 1);
    if (e->golden && rng_next(&S.rng) < 0.35) pickup_drop(PK_COIN, e->x + 6, e->y - 4, 3);   /* hora dorada */
    if (e->beh == BEH_THIEF) {   /* Meowth: monedas; Gholdengo: un ticket ×10 */
      const int n = e->loot10 ? 6 : 20;
      for (int i = 0; i < n; i++) pickup_drop(PK_COIN, e->x + (rng_next(&S.rng) * 72 - 36), e->y + (rng_next(&S.rng) * 52 - 26), 5);
      if (e->loot10) pickup_drop(PK_TICKET10, e->x, e->y - 12, 1);
    }
    if (e->legend) {
      for (int i = 0; i < 3; i++) pickup_drop(PK_TICKET, e->x + (rng_next(&S.rng) * 60 - 30), e->y + (rng_next(&S.rng) * 40 - 20), 1);
      for (int i = 0; i < 10; i++) pickup_drop(PK_COIN, e->x + (rng_next(&S.rng) * 100 - 50), e->y + (rng_next(&S.rng) * 70 - 35), 8);
    }
  }
}
void apply_slow(Enemy *e, double f, double dur) { if (e->arceus) return; e->slow = fmax(e->slow, f); e->slowT = fmax(e->slowT, dur); }
void apply_burn(Enemy *e, double n) { if (e->arceus) return; e->burn = fmin(8, e->burn + n); e->burnT = 3; }
void apply_poison(Enemy *e, double n) { if (e->arceus) return; e->poison = fmin(8, e->poison + n); e->poisonT = 4; }
/* × a quemaduras, venenos, frenazos y empujones: Potencia Bruta los quita, Dicha los dobla */
static int status_k(const Player *p) { const int f = abil_flags(p); return f & AF_SHEER ? 0 : f & AF_SERENE ? 2 : 1; }
static bool crit_roll(const Player *p) {   /* (+25 % con la Focosfera) */
  const double c = p->critChance + (p->orbT[ORB_FOCUS] > 0 ? 0.25 : 0);
  return c > 0 && rng_next(&S.rng) < c;
}
static void on_dealt(Player *p, double dmg) { if (p->item == IT_SHELLBELL) p->bellHeal = fmin(4, p->bellHeal + dmg * 0.04); }

/* Combat.hit: tabla de tipos, defensas, crítico, estados. */
static void hit(Player *pl, Enemy *e, double dmg, double dx, double dy, double knock, PMove *m) {
  const MoveDef *d = &core_moves[m->def];
  const MoveStat *s = pm_stat(m);
  const double k = type_mult(d->type, e->types) * wx_mult(d->type) * stats_taken(e->mon, d->cat) * abil_out(pl, m, e) * (e->arceus ? S.arcK : 1);
  const bool crit = crit_roll(pl);
  const int sk = status_k(pl);
  dmg *= k * (crit ? abil_crit_mul(pl) : 1);
  enemy_hurt(e, dmg, dx, dy, sk ? knock : 0, (int)(pl - S.pl));
  on_dealt(pl, dmg);
  pl->dmgDealt += dmg;
  m->dealt += dmg;
  if (s->burn && sk) apply_burn(e, s->burn * sk);
  if (s->poison && sk) apply_poison(e, s->poison * sk);
  if (s->slow && sk) apply_slow(e, fmin(0.8, s->slow * sk), 1.2);
  abil_hit(pl, e, m);
}

static void damage_prop(Prop *p, double dmg) {
  Prop gone;
  if (world_damage_prop(p, dmg, &gone)) { sim_event(EV_PROP, -1, gone.type, gone.x, gone.y, gone.kind, gone.tx, gone.ty); pickup_prop_loot(&gone); }
}
/* Golpe a los objetos de un círculo que cumplan ok (o todos). */
static void props_hit(double x, double y, double r, double dmg, bool (*ok)(const Prop *, const void *), const void *c) {
  Prop *in[256];
  const int n = world_props_in_circle(x, y, r, in, 256);
  int ids[256];
  for (int i = 0; i < n; i++) ids[i] = in[i]->id;
  /* (romper uno mueve los demás en su trozo: se buscan otra vez por id) */
  for (int i = 0; i < n; i++) {
    Prop *q[256]; const int m = world_props_in_circle(x, y, r, q, 256);
    for (int j = 0; j < m; j++) if (q[j]->id == ids[i]) { if (!ok || ok(q[j], c)) damage_prop(q[j], dmg); break; }
  }
}

/* ================= qué hace cada tipo de ataque ================= */

static bool targeted(int k) {
  return k == MK_MELEE || k == MK_BEAM || k == MK_PROJECTILE || k == MK_BOOMERANG || k == MK_CHAIN || k == MK_METEOR || k == MK_DASH ||
         k == MK_CONE || k == MK_HOMING || k == MK_BOUNCE || k == MK_CHARGE || k == MK_SPIN || k == MK_QUAKE || k == MK_VORTEX ||
         k == MK_SHOVE || k == MK_STUN;
}
static bool free_aim(int k) {
  return k == MK_MELEE || k == MK_BEAM || k == MK_PROJECTILE || k == MK_BOOMERANG || k == MK_DASH || k == MK_CONE || k == MK_HOMING ||
         k == MK_BOUNCE || k == MK_CHARGE || k == MK_SPIN || k == MK_QUAKE || k == MK_SHOVE;
}
static double reach(int k, const MoveStat *m) {
  switch (k) {
    case MK_MELEE: return m->radius + 30;
    case MK_BEAM: return m->radius + 20;
    case MK_BOOMERANG: return m->radius + 40;
    case MK_CHAIN: return 280;
    case MK_METEOR: return 340;
    case MK_DASH: return m->radius + 60;
    case MK_CONE: return m->speed * m->life + 30;
    case MK_SPIN: case MK_SHOVE: case MK_CHARGE: return m->radius + 20;
    case MK_QUAKE: return ival(m->count) * QSTEP + m->radius;
    case MK_VORTEX: case MK_STUN: return 300;
  }
  return 520;
}

static Proj *new_proj(int owner, const PMove *m, int src) {
  if (S.npr >= MAXPR) return NULL;
  Proj *p = &S.pr[S.npr++];
  *p = (Proj){ .id = ++S.next_pr, .owner = owner, .move = m ? m->def : -1, .src = src, .friendly = true, .dmg = 10, .r = 6,
               .life = 1.4, .rehit = 0.34, .mtype = -1 };
  if (m) {   /* payload */
    const MoveStat *s = pm_stat(m);
    p->burn = s->burn; p->poison = s->poison; p->slow = s->slow; p->knock = s->knock; p->bounce = ival(s->bounce); p->drain = s->drain;
    p->mtype = core_moves[m->def].type; p->mcat = core_moves[m->def].cat;
  }
  return p;
}

static void shot(Player *pl, PMove *m, int src, double a) {
  const MoveStat *s = pm_stat(m);
  Proj *p = new_proj((int)(pl - S.pl), m, src);
  if (!p) return;
  p->x = pl->x + cos(a) * 3; p->y = pl->y + sin(a) * 3;
  p->vx = cos(a) * s->speed; p->vy = sin(a) * s->speed;
  p->dmg = s->dmg * atk_for(pl, m); p->r = s->size; p->life = s->life;
  p->pierce = ival(s->pierce); p->homing = s->homing;
}

static void fire(Player *pl, PMove *m, int src) {
  const MoveStat *s = pm_stat(m);
  const int n = ival(s->count) > 1 ? ival(s->count) : 1;
  const double spread = s->spread;
  for (int i = 0; i < n; i++) {
    const double off = n == 1 ? 0 : ((double)i / (n - 1) - 0.5) * spread * n;
    shot(pl, m, src, pl->aim + off + rnd(-0.03, 0.03));
  }
}

static void nova(Player *pl, PMove *m, int src) {
  const MoveStat *s = pm_stat(m);
  const int n = ival(s->count) > 3 ? ival(s->count) : 3;
  for (int i = 0; i < n; i++) shot(pl, m, src, ((double)i / n) * 6.2832 + rnd(-0.06, 0.06));
  sim_event(EV_RING, (int)(pl - S.pl), m->def, pl->x, pl->y, pl->r, pl->r * 4, 0);
}

static bool in_arc(double px, double py, double x, double y, double aim, double half) {
  const double a = atan2(y - py, x - px);
  return fabs(fmod(a - aim + PI * 3, 6.2832) - PI) <= half;
}
typedef struct { double px, py, aim, half; } ArcC;
static bool prop_in_arc(const Prop *p, const void *c) { const ArcC *a = c; return in_arc(a->px, a->py, p->x, p->y, a->aim, a->half); }

static void melee(Player *pl, PMove *m) {
  const MoveStat *s = pm_stat(m);
  const double half = fmin(s->arc, 6.2832) / 2;
  sim_event(EV_SLASH, (int)(pl - S.pl), m->def, pl->x, pl->y, pl->aim, s->radius, s->arc);
  int in[MAXEN]; const int n = sim_query_circle(pl->x, pl->y, s->radius, in, MAXEN);
  for (int i = 0; i < n; i++) {
    Enemy *e = &S.en[in[i]];
    if (!in_arc(pl->x, pl->y, e->x, e->y, pl->aim, half)) continue;
    hit(pl, e, s->dmg * atk_for(pl, m), e->x - pl->x, e->y - pl->y, s->knock, m);
  }
  const ArcC c = { pl->x, pl->y, pl->aim, half };
  props_hit(pl->x, pl->y, s->radius, s->dmg * atk_for(pl, m), prop_in_arc, &c);
}

typedef struct { double x, y, ca, sa, len, w; } BeamC;
static bool on_beam(const BeamC *b, double x, double y, double r) {
  const double px = x - b->x, py = y - b->y, along = px * b->ca + py * b->sa;
  if (along < -r || along > b->len + r) return false;
  return fabs(-px * b->sa + py * b->ca) <= b->w / 2 + r;
}
static bool prop_on_beam(const Prop *p, const void *c) { return on_beam(c, p->x, p->y, p->r); }

static void beam(Player *pl, PMove *m) {
  const MoveStat *s = pm_stat(m);
  const double w = s->width, ca = cos(pl->aim), sa = sin(pl->aim);
  double len = s->radius;   /* se corta en la primera pared */
  for (double d = 8; d < s->radius; d += 8) {
    const double x = pl->x + ca * d, y = pl->y + sa * d;
    if (world_terrain((int32_t)floor(x / WORLD_TS), (int32_t)floor(y / WORLD_TS)) == TER_WALL) { len = d; break; }
  }
  sim_event(EV_BEAM, (int)(pl - S.pl), m->def, pl->x, pl->y, pl->aim, len, w);
  const BeamC b = { pl->x, pl->y, ca, sa, len, w };
  const double mx = pl->x + ca * len / 2, my = pl->y + sa * len / 2;
  int in[MAXEN]; const int n = sim_query_circle(mx, my, len / 2 + w, in, MAXEN);
  for (int i = 0; i < n; i++) {
    Enemy *e = &S.en[in[i]];
    if (on_beam(&b, e->x, e->y, e->r)) hit(pl, e, s->dmg * atk_for(pl, m), ca, sa, 0, m);
  }
  props_hit(mx, my, len / 2 + w, s->dmg * atk_for(pl, m), prop_on_beam, &b);
}

static void aura(Player *pl, PMove *m) {
  const MoveStat *s = pm_stat(m);
  sim_event(EV_RING, (int)(pl - S.pl), m->def, pl->x, pl->y, s->radius * 0.5, s->radius, 1);
  double healed = 0;
  int in[MAXEN]; const int n = sim_query_circle(pl->x, pl->y, s->radius, in, MAXEN);
  for (int i = 0; i < n; i++) {
    Enemy *e = &S.en[in[i]];
    hit(pl, e, s->dmg * atk_for(pl, m), e->x - pl->x, e->y - pl->y, 0, m);
    if (s->drain) healed += s->drain;
  }
  props_hit(pl->x, pl->y, s->radius, s->dmg * atk_for(pl, m), NULL, NULL);
  if (healed > 0) player_heal(pl, fmin(healed, 6));
}

static void boomerang(Player *pl, PMove *m, int src) {
  const MoveStat *s = pm_stat(m);
  const int n = ival(s->count) > 1 ? ival(s->count) : 1;
  const double spread = s->spread ? s->spread : 0.5, out = s->radius / s->speed;
  for (int i = 0; i < n; i++) {
    const double a = pl->aim + (n == 1 ? 0 : ((double)i / (n - 1) - 0.5) * spread * (n < 3 ? n : 3));
    Proj *p = new_proj((int)(pl - S.pl), m, src);
    if (!p) return;
    p->x = pl->x; p->y = pl->y; p->vx = cos(a) * s->speed; p->vy = sin(a) * s->speed;
    p->dmg = s->dmg * atk_for(pl, m); p->r = s->size; p->life = out * 4 + 1.5; p->pierce = 999;
    p->boom = out; p->bsp = s->speed * 1.1;
  }
}

static int target_index(const Player *pl) {   /* su blanco, si es un enemigo vivo */
  if (!pl->hasTarget || !pl->targetId) return -1;
  for (int i = 0; i < S.ne; i++) if (S.en[i].id == pl->targetId) return S.en[i].dead ? -1 : i;
  return -1;
}

static void chain(Player *pl, PMove *m) {
  const MoveStat *s = pm_stat(m);
  int cur = target_index(pl);
  if (cur < 0) cur = proj_nearest(pl->x, pl->y, reach(MK_CHAIN, s));
  if (cur < 0) return;
  double fx = pl->x, fy = pl->y, k = 1;
  int done[64], nd = 0;
  const int n = ival(s->count) > 1 ? ival(s->count) : 1;
  for (int i = 0; i < n && cur >= 0; i++) {
    Enemy *e = &S.en[cur];
    if (nd < 64) done[nd++] = e->id;
    const double tx = e->x, ty = e->y;
    sim_event(EV_BEAM, (int)(pl - S.pl), m->def, fx, fy, atan2(ty - fy, tx - fx), js_hypot(tx - fx, ty - fy), -10);
    const double hex = s->hex && (e->burn > 0 || e->poison > 0 || e->slow > 0) ? s->hex : 1;
    hit(pl, e, s->dmg * atk_for(pl, m) * k * hex, tx - fx, ty - fy, 0, m);
    k *= 0.85;
    fx = tx; fy = ty;
    int best = -1; double bd = s->radius * s->radius;
    int in[MAXEN]; const int q = sim_query_circle(e->x, e->y, s->radius, in, MAXEN);
    for (int j = 0; j < q; j++) {
      const Enemy *o = &S.en[in[j]];
      bool seen = false;
      for (int t = 0; t < nd; t++) seen |= done[t] == o->id;
      if (seen) continue;
      const double d = u_dist2(e->x, e->y, o->x, o->y);
      if (d < bd) { bd = d; best = in[j]; }
    }
    cur = best;
  }
}

static Field *new_field(int kind, int owner, int mv, double x, double y) {
  if (S.nfi >= MAXFI) return NULL;
  Field *f = &S.fi[S.nfi++];
  *f = (Field){ .kind = kind, .owner = owner, .mv = mv, .id = ++S.next_fi, .x = x, .y = y };
  return f;
}
/* Como mucho `keep` de ese tipo por jugador: los más viejos se van. */
static void cap_fields(int kind, int owner, int keep) {
  int n = 0;
  for (int i = 0; i < S.nfi; i++) if (S.fi[i].kind == kind && S.fi[i].owner == owner && !S.fi[i].gone) n++;
  for (int i = 0; i < S.nfi && n > keep; i++) if (S.fi[i].kind == kind && S.fi[i].owner == owner && !S.fi[i].gone) { S.fi[i].gone = true; n--; }
}

static void mines(Player *pl, PMove *m, int src) {
  const MoveStat *s = pm_stat(m);
  const int n = ival(s->count) > 1 ? ival(s->count) : 1, who = (int)(pl - S.pl);
  for (int i = 0; i < n; i++) {
    const double a = rng_next(&S.rng) * 6.2832, d = n == 1 ? 0 : rnd(18, 46);
    Field *f = new_field(FK_MINE, who, src, pl->x + cos(a) * d, pl->y + sin(a) * d * 0.8);
    if (!f) break;
    f->arm = 0.35; f->life = s->dur ? s->dur : 7; f->r = s->radius; f->dmg = s->dmg * atk_for(pl, m);
  }
  /* (en el JS las minas no cuentan `gone` al recortar: aquí tampoco hace falta, se van al momento) */
  int k = 0;
  for (int i = 0; i < S.nfi; i++) if (S.fi[i].kind == FK_MINE && S.fi[i].owner == who) k++;
  for (int i = 0; i < S.nfi && k > 4 + n * 2; i++) if (S.fi[i].kind == FK_MINE && S.fi[i].owner == who && !S.fi[i].gone) { S.fi[i].gone = true; k--; }
}

static void meteors(Player *pl, PMove *m, int src) {
  const MoveStat *s = pm_stat(m);
  const int n = ival(s->count) > 1 ? ival(s->count) : 1, who = (int)(pl - S.pl);
  int near[MAXEN]; int q = sim_query_circle(pl->x, pl->y, reach(MK_METEOR, s), near, MAXEN);
  for (int i = q - 1; i > 0; i--) { const int j = (int)(rng_next(&S.rng) * (i + 1)); const int t = near[i]; near[i] = near[j]; near[j] = t; }
  for (int i = 0; i < n; i++) {
    const Enemy *e = i < q ? &S.en[near[i]] : NULL;
    const double x = e ? e->x + rnd(-8, 8) : pl->x + rnd(-140, 140), y = e ? e->y + rnd(-6, 6) : pl->y + rnd(-110, 110);
    Field *f = new_field(FK_METEOR, who, src, x, y);
    if (!f) break;
    f->t = -i * 0.09; f->fall = 0.5; f->r = s->radius; f->dmg = s->dmg * atk_for(pl, m);
  }
}

static void turret(Player *pl, PMove *m, int src) {
  const MoveStat *s = pm_stat(m);
  const double a = pl->aim + PI + rnd(-0.6, 0.6);
  const int who = (int)(pl - S.pl);
  Field *f = new_field(FK_TURRET, who, src, pl->x + cos(a) * 26, pl->y + sin(a) * 20);
  if (!f) return;
  f->life = s->dur ? s->dur : 6; f->shotT = 0.3; f->dmg = s->dmg * atk_for(pl, m);
  cap_fields(FK_TURRET, who, ival(s->count) > 1 ? ival(s->count) : 1);
}

static double seg_dist2(double ax, double ay, double bx, double by, double cx, double cy) {
  const double dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  double t = l2 ? ((cx - ax) * dx + (cy - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const double qx = ax + dx * t - cx, qy = ay + dy * t - cy;
  return qx * qx + qy * qy;
}
typedef struct { double sx, sy, ex, ey, w; } SegC;
static bool prop_on_seg(const Prop *p, const void *c) {
  const SegC *g = c; const double rr = g->w / 2 + p->r;
  return seg_dist2(g->sx, g->sy, g->ex, g->ey, p->x, p->y) <= rr * rr;
}

static void dash(Player *pl, PMove *m) {
  const MoveStat *s = pm_stat(m);
  const double ca = cos(pl->aim), sa = sin(pl->aim), sx = pl->x, sy = pl->y;
  double len = 0;
  for (double d = 8; d <= s->radius; d += 8) {
    if (!world_is_free(sx + ca * d, sy + sa * d, pl->r * 0.8, true)) break;
    len = d;
  }
  sim_event(EV_DASH, (int)(pl - S.pl), m->def, sx, sy, pl->aim, len, 0);
  pl->x = sx + ca * len; pl->y = sy + sa * len;
  world_collide(&pl->x, &pl->y, pl->r);
  pl->invuln = fmax(pl->invuln, 0.3);
  const double w = s->width ? s->width : 34, mx = sx + ca * len / 2, my = sy + sa * len / 2;
  int in[MAXEN]; const int n = sim_query_circle(mx, my, len / 2 + w, in, MAXEN);
  for (int i = 0; i < n; i++) {
    Enemy *e = &S.en[in[i]];
    const double rr = w / 2 + e->r;
    if (seg_dist2(sx, sy, pl->x, pl->y, e->x, e->y) <= rr * rr) hit(pl, e, s->dmg * atk_for(pl, m), ca, sa, s->knock, m);
  }
  const SegC g = { sx, sy, pl->x, pl->y, w };
  props_hit(mx, my, len / 2 + w, s->dmg * atk_for(pl, m), prop_on_seg, &g);
}

static void trail(Player *pl, PMove *m, int src) {
  const MoveStat *s = pm_stat(m);
  const int who = (int)(pl - S.pl);
  /* parado no deja uno nuevo encima del anterior (sólo de vez en cuando) */
  for (int i = 0; i < S.nfi; i++) {
    const Field *l = &S.fi[i];
    if (l->id != pl->lastPatch) continue;
    if (u_dist2(l->x, l->y, pl->x, pl->y) < (s->radius * 0.9) * (s->radius * 0.9) && l->t < 1) return;
  }
  Field *f = new_field(FK_PATCH, who, src, pl->x, pl->y);
  if (!f) return;
  f->life = s->dur ? s->dur : 3; f->r = s->radius; f->dmg = s->dmg * atk_for(pl, m);
  pl->lastPatch = f->id;
  cap_fields(FK_PATCH, who, 18);
}

static void cone(Player *pl, PMove *m, int src) {
  const MoveStat *s = pm_stat(m);
  const int n = ival(s->count) > 2 ? ival(s->count) : 2;
  const double arc = s->arc ? s->arc : 0.9;
  for (int i = 0; i < n; i++) {
    const double a = pl->aim + ((double)i / (n - 1) - 0.5) * arc + rnd(-0.05, 0.05), sp = s->speed * rnd(0.85, 1.1);
    Proj *p = new_proj((int)(pl - S.pl), m, src);
    if (!p) return;
    p->x = pl->x + cos(a) * 4; p->y = pl->y + sin(a) * 4; p->vx = cos(a) * sp; p->vy = sin(a) * sp;
    p->dmg = s->dmg * atk_for(pl, m); p->r = s->size; p->life = s->life * rnd(0.85, 1.05); p->pierce = ival(s->pierce);
  }
}

/* El blanco de un ataque que va a un sitio: el de siempre si llega; si no, el más cercano. */
static int spot_for(const Player *pl, int kind, const MoveStat *s) {
  const int t = target_index(pl);
  if (t >= 0 && js_hypot(S.en[t].x - pl->x, S.en[t].y - pl->y) <= reach(kind, s)) return t;
  return proj_nearest(pl->x, pl->y, reach(kind, s));
}

static void shove(Player *pl, PMove *m) {
  const MoveStat *s = pm_stat(m);
  sim_event(EV_RING, (int)(pl - S.pl), m->def, pl->x, pl->y, pl->r, s->radius, 2);
  int in[MAXEN]; const int n = sim_query_circle(pl->x, pl->y, s->radius, in, MAXEN);
  for (int i = 0; i < n; i++) {
    Enemy *e = &S.en[in[i]];
    hit(pl, e, s->dmg * atk_for(pl, m), e->x - pl->x, e->y - pl->y, s->knock ? s->knock : 300, m);
  }
  props_hit(pl->x, pl->y, s->radius, s->dmg * atk_for(pl, m), NULL, NULL);
}

static void orbit(Player *pl, PMove *m, int src, double dt) {
  const MoveStat *s = pm_stat(m);
  const int who = (int)(pl - S.pl), want = ival(s->count) > 1 ? ival(s->count) : 1;
  int idx[MAXPR], n = 0;
  for (int i = 0; i < S.npr; i++) if (S.pr[i].orb && S.pr[i].owner == who && S.pr[i].move == m->def) idx[n++] = i;
  const bool relayout = n != want;
  const double base = n ? S.pr[idx[0]].oa : S.time * s->speed;
  if (n > want) {   /* fuera los que sobran */
    int k = 0, seen = 0;
    for (int i = 0; i < S.npr; i++) {
      const Proj *p = &S.pr[i];
      if (p->orb && p->owner == who && p->move == m->def && seen++ >= want) continue;
      S.pr[k++] = S.pr[i];
    }
    S.npr = k;
  }
  for (int i = n; i < want; i++) {
    Proj *p = new_proj(who, m, src);
    if (!p) break;
    p->orb = true; p->life = INFINITY; p->pierce = 1 << 30; p->x = pl->x; p->y = pl->y;
    p->oa = ((double)i / want) * 6.2832; p->rehit = fmax(0.12, s->cd); p->drain = 0; p->bounce = 0;
  }
  n = 0;
  for (int i = 0; i < S.npr; i++) if (S.pr[i].orb && S.pr[i].owner == who && S.pr[i].move == m->def) idx[n++] = i;
  for (int i = 0; i < n; i++) {
    Proj *p = &S.pr[idx[i]];
    p->dmg = s->dmg * atk_for(pl, m); p->orad = s->radius; p->ospeed = s->speed; p->r = s->size;
    if (relayout) p->oa = base + ((double)i / n) * 6.2832;
  }
  if ((pl->orbCastT -= dt) <= 0) { pl->orbCastT = 1.6; sim_event(EV_CAST, who, m->def, pl->x, pl->y, MK_ORBIT, 1.6, 0); }
}

static void run(Player *pl, PMove *m, int src) {
  const MoveStat *s = pm_stat(m);
  const int who = (int)(pl - S.pl);
  switch (core_moves[m->def].kind) {
    case MK_PROJECTILE: case MK_HOMING: case MK_BOUNCE: fire(pl, m, src); break;
    case MK_MELEE: melee(pl, m); break;
    case MK_BEAM: beam(pl, m); break;
    case MK_NOVA: nova(pl, m, src); break;
    case MK_AURA: aura(pl, m); break;
    case MK_BUFF: add_buff(pl, s->stat, s->amount, s->dur, ival(s->stacks)); sim_event(EV_RING, who, m->def, pl->x, pl->y, pl->r * 2.4, pl->r * 1.1, 3); break;
    case MK_BOOMERANG: boomerang(pl, m, src); break;
    case MK_CHAIN: chain(pl, m); break;
    case MK_MINE: mines(pl, m, src); break;
    case MK_METEOR: meteors(pl, m, src); break;
    case MK_TURRET: turret(pl, m, src); break;
    case MK_DASH: dash(pl, m); break;
    case MK_TRAIL: trail(pl, m, src); break;
    case MK_CONE: cone(pl, m, src); break;
    case MK_CHARGE: { Field *f = new_field(FK_CHARGE, who, src, pl->x, pl->y); if (f) f->at = s->charge ? s->charge : 0.75; break; }
    case MK_SPIN: { Field *f = new_field(FK_SPIN, who, src, pl->x, pl->y); if (f) { f->n = ival(s->count) > 1 ? ival(s->count) : 1; f->a = pl->aim; } break; }
    case MK_QUAKE: {
      Field *f = new_field(FK_QUAKE, who, src, pl->x, pl->y);
      if (f) { f->ca = cos(pl->aim); f->sa = sin(pl->aim); f->n = ival(s->count) > 1 ? ival(s->count) : 1; f->dmg = s->dmg * atk_for(pl, m); }
      break;
    }
    case MK_VORTEX: {
      const int tg = spot_for(pl, MK_VORTEX, s);
      const double x = tg >= 0 ? S.en[tg].x : pl->x + cos(pl->aim) * 120, y = tg >= 0 ? S.en[tg].y : pl->y + sin(pl->aim) * 100;
      Field *f = new_field(FK_VORTEX, who, src, x, y);
      if (f) { f->life = s->dur ? s->dur : 2.6; f->r = s->radius; f->tick = 0.15; f->dmg = s->dmg * atk_for(pl, m); f->pull = s->pull ? s->pull : 140; }
      cap_fields(FK_VORTEX, who, 2);
      break;
    }
    case MK_SHOVE: shove(pl, m); break;
    case MK_STUN: {
      const int tg = spot_for(pl, MK_STUN, s);
      if (tg < 0) break;
      Field *f = new_field(FK_STUNZONE, who, src, S.en[tg].x, S.en[tg].y);
      if (f) { f->delay = 0.45; f->r = s->radius; f->dmg = s->dmg * atk_for(pl, m); }
      break;
    }
  }
}

/* Combat.tick: los ataques del hueco activo, cada uno con su recarga. */
void combat_tick(Player *pl, double dt) {
  if (pl->dead || !pl->nslot) return;
  const int sl = pl->active;
  for (int k = 0; k < pl->slotn[sl]; k++) {
    const int src = pl->slot[sl][k];
    PMove *m = &pl->mv[src];
    const int kind = core_moves[m->def].kind;
    const MoveStat *s = pm_stat(m);
    if (kind == MK_ORBIT) { orbit(pl, m, src, dt); continue; }
    m->t -= dt;
    if (m->t > 0) continue;
    /* los que necesitan blanco esperan a tenerlo a tiro */
    if (targeted(kind) && !(pl->manualAim && free_aim(kind)) &&
        !(pl->hasTarget && js_hypot(pl->tx - pl->x, pl->ty - pl->y) <= reach(kind, s))) { m->t = 0.05; continue; }
    m->t = fmax(0.05, s->cd * pl->cdMul * (kind == MK_BUFF ? abil_status_cd(pl) : 1));
    if (pl->item == IT_LIFEORB && kind != MK_TRAIL) pl->hp = fmax(1, pl->hp - fmax(1, pl->maxHp * 0.01));   /* Vidasfera */
    sim_event(EV_CAST, (int)(pl - S.pl), m->def, pl->x, pl->y, kind, s->cd * pl->cdMul, 0);
    run(pl, m, src);
  }
}

/* ================= campos (minas, meteoros, torretas, charcos, carga, giro, terremoto, remolino, aturdir) ================= */

static void blast(const Field *f, double x, double y, double r, double k) {
  Player *pl = &S.pl[f->owner];
  PMove *m = &pl->mv[f->mv];
  const MoveStat *s = pm_stat(m);
  int in[MAXEN]; const int n = sim_query_circle(x, y, r, in, MAXEN);
  for (int i = 0; i < n; i++) { Enemy *e = &S.en[in[i]]; hit(pl, e, f->dmg * k, e->x - x, e->y - y, s->knock, m); }
  props_hit(x, y, r, f->dmg * k, NULL, NULL);
  sim_event(EV_BLAST, f->owner, m->def, x, y, r, 0, 0);
}

static bool tick_new(Field *f, double dt) {   /* → true si hay que quitarlo */
  Player *pl = &S.pl[f->owner];
  PMove *m = &pl->mv[f->mv];
  const MoveStat *s = pm_stat(m);
  switch (f->kind) {
    case FK_CHARGE:
      f->x = pl->x; f->y = pl->y;
      if (f->t < f->at) return false;
      if (pl->dead) return true;
      beam(pl, m);
      return true;
    case FK_SPIN: {
      f->next -= dt;
      if (f->next > 0) return false;
      f->next = 0.13;
      sim_event(EV_SLASH, f->owner, m->def, pl->x, pl->y, f->a, s->radius, 3.6);
      f->a += 2.2;
      if (!pl->dead) {
        const double d = s->dmg * atk_for(pl, m);
        int in[MAXEN]; const int n = sim_query_circle(pl->x, pl->y, s->radius, in, MAXEN);
        for (int i = 0; i < n; i++) { Enemy *e = &S.en[in[i]]; hit(pl, e, d, e->x - pl->x, e->y - pl->y, 40, m); }
        props_hit(pl->x, pl->y, s->radius, d, NULL, NULL);
      }
      return --f->n <= 0;
    }
    case FK_QUAKE:
      f->next -= dt;
      while (f->next <= 0 && f->i < f->n) {
        f->next += 0.07; f->i++;
        const double x = f->x + f->ca * f->i * QSTEP, y = f->y + f->sa * f->i * QSTEP;
        if (world_terrain((int32_t)floor(x / WORLD_TS), (int32_t)floor(y / WORLD_TS)) == TER_WALL) { f->i = f->n; break; }
        blast(f, x, y, s->radius, 1);
      }
      return f->i >= f->n;
    case FK_VORTEX: {
      int in[MAXEN]; const int n = sim_query_circle(f->x, f->y, f->r * 1.4, in, MAXEN);
      for (int i = 0; i < n; i++) {
        Enemy *e = &S.en[in[i]];
        if (e->dead) continue;
        const double dx = f->x - e->x, dy = f->y - e->y, d = js_hypot(dx, dy);
        if (d < 4) continue;
        const double k = fmin(d, f->pull * dt * (e->boss || e->judge ? 0.25 : 1));
        e->x += dx / d * k; e->y += dy / d * k;
      }
      f->tick -= dt;
      if (f->tick <= 0) { f->tick = 0.4; blast(f, f->x, f->y, f->r, 1); }
      return false;
    }
    case FK_STUNZONE: {
      if (f->t < f->delay) return false;
      int in[MAXEN]; const int n = sim_query_circle(f->x, f->y, f->r, in, MAXEN);
      for (int i = 0; i < n; i++) {
        Enemy *e = &S.en[in[i]];
        hit(pl, e, f->dmg, e->x - f->x, e->y - f->y, 0, m);
        if (!e->dead && !e->arceus) e->stunT = fmax(e->stunT, (s->stun ? s->stun : 1) * (e->boss || e->judge ? 0.35 : 1));
      }
      props_hit(f->x, f->y, f->r, f->dmg, NULL, NULL);
      sim_event(EV_BLAST, f->owner, m->def, f->x, f->y, f->r, 1, 0);
      return true;
    }
  }
  return false;
}

static void remove_field(int i) { memmove(&S.fi[i], &S.fi[i + 1], (size_t)(S.nfi - i - 1) * sizeof *S.fi); S.nfi--; }

void combat_fields(double dt) {
  for (int i = S.nfi - 1; i >= 0; i--) {
    Field *f = &S.fi[i];
    f->t += dt;
    if (f->gone || f->owner >= S.np || (f->life && f->t >= f->life && f->kind != FK_MINE)) { remove_field(i); continue; }
    if (f->kind >= FK_CHARGE) { if (tick_new(f, dt)) remove_field(i); continue; }
    Player *pl = &S.pl[f->owner];
    PMove *m = &pl->mv[f->mv];
    const MoveStat *s = pm_stat(m);
    if (f->kind == FK_MINE) {
      int in[1]; const bool trig = f->t >= f->arm && sim_query_circle(f->x, f->y, 14, in, 1) > 0;
      if (trig || f->t >= f->life) { blast(f, f->x, f->y, f->r, trig ? 1 : 0.5); remove_field(i); }
    } else if (f->kind == FK_METEOR) {
      if (f->t >= f->fall) { blast(f, f->x, f->y, f->r, 1); remove_field(i); }
    } else if (f->kind == FK_TURRET) {
      f->shotT -= dt;
      if (f->shotT <= 0) {
        const int tg = proj_nearest(f->x, f->y, s->range ? s->range : 300);
        f->shotT = tg >= 0 ? (s->rate ? s->rate : 0.6) : 0.15;
        if (tg >= 0) {
          const double a = atan2(S.en[tg].y - f->y, S.en[tg].x - f->x), sp = s->speed ? s->speed : 300;
          const double fx = f->x, fy = f->y, dmg = f->dmg; const int owner = f->owner, mv = f->mv;
          Proj *p = new_proj(owner, m, mv);   /* (puede mover S.fi: no; sólo S.pr) */
          if (p) {
            p->x = fx; p->y = fy; p->vx = cos(a) * sp; p->vy = sin(a) * sp;
            p->dmg = dmg; p->r = s->size ? s->size : 6; p->life = 1.4; p->pierce = ival(s->pierce);
          }
        }
      }
    } else if (f->kind == FK_PATCH) {
      f->tick -= dt;
      if (f->tick <= 0) { f->tick = 0.5; blast(f, f->x, f->y, f->r, 1); }
    }
  }
}

/* ================= proyectiles ================= */

static void remove_proj(int i) { memmove(&S.pr[i], &S.pr[i + 1], (size_t)(S.npr - i - 1) * sizeof *S.pr); S.npr--; }
static inline double damp(double a, double b, double rate, double dt) { return b + (a - b) * exp(-rate * dt); }

void proj_update(double dt) {
  for (int i = S.npr - 1; i >= 0; i--) {
    Proj *p = &S.pr[i];
    p->t += dt;
    const Player *o = p->owner >= 0 && p->owner < S.np ? &S.pl[p->owner] : NULL;
    if (p->orb) {
      if (!o) { remove_proj(i); continue; }
      p->oa += p->ospeed * dt;
      p->x = o->x + cos(p->oa) * p->orad;
      p->y = o->y + sin(p->oa) * p->orad * 0.7;
      continue;
    }
    if (p->t >= p->life) { remove_proj(i); continue; }
    if (p->boom && o) {   /* bumerán: a los `boom` s vuelve (y puede volver a golpear a los mismos) */
      if (!p->back && p->t >= p->boom) { p->back = true; p->nhits = 0; }
      if (p->back) {
        double dx, dy;
        u_norm(o->x - p->x, o->y - p->y, &dx, &dy);
        p->vx = damp(p->vx, dx * p->bsp, 7, dt);
        p->vy = damp(p->vy, dy * p->bsp, 7, dt);
        if (u_dist2(p->x, p->y, o->x, o->y) < (o->r + 8) * (o->r + 8)) { remove_proj(i); continue; }
      }
    }
    if (p->homing > 0 && p->friendly) {
      const int tg = proj_nearest(p->x, p->y, 340);
      if (tg >= 0) {
        double dx, dy;
        u_norm(S.en[tg].x - p->x, S.en[tg].y - p->y, &dx, &dy);
        const double sp = js_hypot(p->vx, p->vy);
        p->vx = damp(p->vx, dx * sp, p->homing, dt);
        p->vy = damp(p->vy, dy * sp, p->homing, dt);
      }
    }
    p->px = p->x; p->py = p->y; p->moved = true;
    p->x += p->vx * dt;
    p->y += p->vy * dt;
    /* Fuera de la vista de todos, con margen: se descarta (en el JS, la de la cámara + 260). */
    bool seen = false;
    for (int k = 0; k < S.np && !seen; k++) {
      const double R = S.pl[k].view + 260;
      seen = S.pl[k].on && u_dist2(p->x, p->y, S.pl[k].x, S.pl[k].y) <= R * R;
    }
    if (!seen) remove_proj(i);
  }
}

static bool hits_has(const Proj *p, int id) { for (int i = 0; i < p->nhits && i < PR_HITS; i++) if (p->hits[i] == id) return true; return false; }
static void hits_add(Proj *p, int id) { p->hits[p->nhits++ % PR_HITS] = id; }   /* ponytail: anillo de 64; con más, puede repetir alguno */
/* Órbitas: ¿ya le tocó hace menos de rehit? (y lo apunta) */
static bool orb_recent(Proj *p, int key) {
  for (int i = 0; i < p->nlog && i < 32; i++) if (p->logk[i] == key) { if (S.time - p->logt[i] < p->rehit) return true; p->logt[i] = S.time; return false; }
  const int k = p->nlog++ % 32; p->logk[k] = key; p->logt[k] = S.time;
  return false;
}

/* El proyectil rebota hacia el enemigo más cercano que aún no ha tocado. → true si rebota. */
static bool rebound(Proj *p, const Enemy *from) {
  if (!(p->bounce > 0)) return false;
  int best = -1; double bd = 220 * 220;
  int in[MAXEN]; const int n = sim_query_circle(from->x, from->y, 220, in, MAXEN);
  for (int i = 0; i < n; i++) {
    const Enemy *e = &S.en[in[i]];
    if (e->dead || hits_has(p, e->id)) continue;
    const double d = u_dist2(from->x, from->y, e->x, e->y);
    if (d < bd) { bd = d; best = in[i]; }
  }
  if (best < 0) return false;
  p->bounce--;
  double sp = js_hypot(p->vx, p->vy), nx, ny;
  if (!sp) sp = 300;
  u_norm(S.en[best].x - from->x, S.en[best].y - from->y, &nx, &ny);
  p->vx = nx * sp; p->vy = ny * sp; p->x = from->x; p->y = from->y;
  p->t = fmax(0, p->t - 0.5);
  return true;
}

void combat_resolve(double dt) {
  (void)dt;
  for (int i = S.npr - 1; i >= 0; i--) {
    Proj *p = &S.pr[i];
    /* --- disparos enemigos: paredes y objetos sólidos dan cobertura --- */
    if (!p->friendly) {
      if (world_projectile_block(p->x, p->y, p->r, NULL)) { remove_proj(i); continue; }
      for (int k = 0; k < S.np; k++) {
        Player *pl = &S.pl[k];
        if (!pl->on || pl->dead) continue;
        if (u_dist2(p->x, p->y, pl->x, pl->y) < (p->r + pl->r) * (p->r + pl->r)) { player_hurt(pl, p->dmg, p->mtype, false, p->mcat); remove_proj(i); break; }
      }
      continue;
    }
    Player *pl = p->owner >= 0 && p->owner < S.np ? &S.pl[p->owner] : NULL;
    if (!pl) { remove_proj(i); continue; }
    if (!p->orb) {
      Prop *b = NULL;
      const int blk = world_projectile_block(p->x, p->y, p->r, &b);
      if (blk == 1 || (blk == 2 && !b->destructible)) { remove_proj(i); continue; }
    }
    /* objetos del escenario (rocas, cofres, hierba) */
    bool consumed = false;
    {
      Prop *in[64]; const int n = world_props_in_circle(p->x, p->y, p->r, in, 64);
      int ids[64]; bool solid[64];
      for (int j = 0; j < n; j++) { ids[j] = in[j]->id; solid[j] = in[j]->solid; }
      for (int j = 0; j < n && !consumed; j++) {
        Prop *q[64]; const int m = world_props_in_circle(p->x, p->y, p->r, q, 64);
        Prop *pr = NULL;
        for (int t = 0; t < m; t++) if (q[t]->id == ids[j]) pr = q[t];
        if (p->orb) { if (pr && !orb_recent(p, -ids[j])) damage_prop(pr, p->dmg); continue; }
        bool seen = false;
        for (int t = 0; t < p->nphits && t < 16; t++) seen |= p->phits[t] == ids[j];
        if (seen) continue;
        p->phits[p->nphits++ % 16] = ids[j];
        if (pr) damage_prop(pr, p->dmg);
        if (solid[j]) { if (p->pierce > 0) p->pierce--; else consumed = true; }   /* la hierba no frena */
      }
    }
    if (consumed) { remove_proj(i); continue; }

    /* Enemigos, con colisión barrida (todo el tramo de este paso). */
    const double sx = p->orb || !p->moved ? p->x : p->px, sy = p->orb || !p->moved ? p->y : p->py;
    const double half = js_hypot(p->x - sx, p->y - sy) / 2;
    int in[MAXEN]; const int n = sim_query_circle((sx + p->x) / 2, (sy + p->y) / 2, half + p->r, in, MAXEN);
    for (int j = 0; j < n; j++) {
      Enemy *e = &S.en[in[j]];
      if (seg_dist2(sx, sy, p->x, p->y, e->x, e->y) > (p->r + e->r) * (p->r + e->r)) continue;
      if (p->orb) { if (orb_recent(p, e->id)) continue; }
      else { if (hits_has(p, e->id)) continue; hits_add(p, e->id); }
      PMove *src = p->src >= 0 && p->src < pl->nmv ? &pl->mv[p->src] : NULL;
      const bool crit = crit_roll(pl);
      const int sk = status_k(pl);
      const double k = (p->mtype >= 0 ? type_mult(p->mtype, e->types) * wx_mult(p->mtype) : 1) * stats_taken(e->mon, p->mcat) *
                       (crit ? abil_crit_mul(pl) : 1) * abil_out(pl, src, e) * (e->arceus ? S.arcK : 1);
      enemy_hurt(e, p->dmg * k, p->vx ? p->vx : e->x - pl->x, p->vy ? p->vy : e->y - pl->y, sk ? p->knock : 0, p->owner);
      pl->dmgDealt += p->dmg * k;
      if (src) src->dealt += p->dmg * k;
      on_dealt(pl, p->dmg * k);
      if (p->burn && sk) apply_burn(e, p->burn * sk);
      if (p->poison && sk) apply_poison(e, p->poison * sk);
      if (p->slow && sk) apply_slow(e, fmin(0.8, p->slow * sk), 1.2);
      if (p->drain) player_heal(pl, p->drain);
      abil_hit(pl, e, src);
      if (!p->orb && rebound(p, e)) break;
      if (!p->orb) {
        if (p->pierce > 0) p->pierce--;
        else { remove_proj(i); break; }
      }
    }
  }

  /* --- contacto enemigo <-> jugador --- */
  for (int k = 0; k < S.np; k++) {
    Player *pl = &S.pl[k];
    if (!pl->on || pl->dead) continue;
    int in[MAXEN]; const int n = sim_query_circle(pl->x, pl->y, pl->r + 40, in, MAXEN);
    for (int j = 0; j < n; j++) {
      Enemy *e = &S.en[in[j]];
      if (u_dist2(e->x, e->y, pl->x, pl->y) > (e->r + pl->r) * (e->r + pl->r)) continue;
      if (e->judge || e->touchCd > 0 || e->beh == BEH_THIEF || e->stunT > 0 || e->sleepT > 0) continue;
      e->touchCd = 0.55;
      player_hurt(pl, e->dmg, e->atkType, false, e->cat);
      if (pl->item == IT_ROCKYHELMET) enemy_hurt(e, 15 + pl->level * 4, e->x - pl->x, e->y - pl->y, 80, k);
      if (!pl->dead && !e->dead) abil_contact(pl, e);
      double nx, ny;
      u_norm(e->x - pl->x, e->y - pl->y, &nx, &ny);
      e->kx += nx * 150; e->ky += ny * 150;
    }
  }
}
