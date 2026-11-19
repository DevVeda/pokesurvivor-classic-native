/* abil.c — lo que hace en la partida la habilidad de cada jugador (G.AbilityFX, L14654), el clima que la cambia
 * (G.Weather.mult / speedFor) y las esferas (G.Orbs: bolsa, usar, mejoras con tiempo). Mismas cuentas que js/app.js
 * (banco: bench-abil.cjs). Lo que la habilidad o el objeto fija al empezar (vida, crítico, imán, ×recarga, monedas) lo
 * pone el JS en su G.Player y llega por core_stats; aquí sólo lo que pasa durante la partida.
 * ponytail: Impostor cambia los stats de su Pokémon (pa/sa/df/sd): aquí no (los del núcleo son los de la Pokédex).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include "core.h"
#include <math.h>
#include <string.h>
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"   /* (las filas sólo llevan lo que usan) */

/* Lo que hace cada fila: una plantilla (t: tipo, clima, categoría o patrón; k, k2: cuánto). */
enum {
  B_NONE, B_PINCH, B_BOOST, B_NAME, B_WATERBUBBLE, B_TECH, B_PHYS_K, B_HUSTLE, B_GUTS, B_ADAPT, B_ALL_K, B_SHEER, B_SERENE,
  B_TOUGH, B_RECKLESS, B_TINTED, B_SCRAPPY, B_SANDFORCE, B_SOLAR, B_SNIPER, B_MOXIE, B_SPEEDBOOST, B_RUSH, B_SPEED_K,
  B_WXHEAL, B_DRYSKIN, B_LEVITATE, B_THICKFAT, B_IN_TYPE, B_ABSORB, B_MULTISCALE, B_FILTER, B_IN_CLS, B_IN_ALL, B_STURDY,
  B_LAVAPROOF, B_STAMINA, B_STEADY, B_C_SLOW, B_C_BURN, B_C_POISON, B_SPORE, B_ROUGH, B_TOUCHPOISON, B_SLOWSTART,
  B_DEFEATIST, B_WONDER, B_SCHOOLING, B_ZEN, B_STANCE, B_DODGE_WX, B_HEALMUL, B_INFILTRATOR, B_DODGE, B_WEAKARMOR,
  B_STEADFAST, B_RATTLED, B_HYDRATION, B_SHEDSKIN, B_LEAFGUARD, B_MOLD, B_DAMP, B_RIVALRY, B_SYNCHRO, B_PRANKSTER,
  B_UNBURDEN, B_DEFIANT, B_WATERVEIL, B_PICKPOCKET, B_ANALYTIC, B_KLUTZ, B_SLOWSPEED, B_MAGICBOUNCE, B_STENCH, B_ANGER,
  B_JUSTIFIED, B_CURSED, B_SPEC_K, B_NOGUARD, B_AFTERMATH, B_MOODY, B_TANGLED, B_SKILLLINK, B_PROTO
};
enum { N_PUNCH, N_JAW, N_PULSE, N_CUT, N_SOUND };
typedef struct { const char *id; unsigned char b; signed char t; bool plus; double k, k2; } Row;
#define P 'p'
#define SP 's'
static const Row ROWS[] = {
  /* más daño */
  { "overgrow", B_PINCH, TY_GRASS }, { "blaze", B_PINCH, TY_FIRE }, { "torrent", B_PINCH, TY_WATER }, { "swarm", B_PINCH, TY_BUG },
  { "steelworker", B_BOOST, TY_STEEL }, { "steely-spirit", B_BOOST, TY_STEEL }, { "dragons-maw", B_BOOST, TY_DRAGON },
  { "transistor", B_BOOST, TY_ELECTRIC }, { "water-bubble", B_WATERBUBBLE }, { "technician", B_TECH },
  { "huge-power", B_PHYS_K, 0, false, 1.5 }, { "pure-power", B_PHYS_K, 0, false, 1.5 }, { "hustle", B_HUSTLE }, { "guts", B_GUTS },
  { "adaptability", B_ADAPT }, { "protean", B_ALL_K, 0, false, 1.12 }, { "libero", B_ALL_K, 0, false, 1.12 },
  { "sheer-force", B_SHEER }, { "serene-grace", B_SERENE }, { "tough-claws", B_TOUGH }, { "reckless", B_RECKLESS },
  { "iron-fist", B_NAME, N_PUNCH, false, 1.25 }, { "strong-jaw", B_NAME, N_JAW, false, 1.3 },
  { "mega-launcher", B_NAME, N_PULSE, false, 1.3 }, { "sharpness", B_NAME, N_CUT, false, 1.3 },
  { "punk-rock", B_NAME, N_SOUND, false, 1.3 }, { "tinted-lens", B_TINTED }, { "scrappy", B_SCRAPPY },
  { "sand-force", B_SANDFORCE }, { "solar-power", B_SOLAR }, { "sniper", B_SNIPER },
  { "super-luck", B_NONE }, { "compound-eyes", B_NONE },
  { "moxie", B_MOXIE }, { "chilling-neigh", B_MOXIE }, { "grim-neigh", B_MOXIE }, { "beast-boost", B_MOXIE },
  /* velocidad */
  { "speed-boost", B_SPEEDBOOST }, { "swift-swim", B_RUSH, WX_RAIN }, { "chlorophyll", B_RUSH, WX_SUN },
  { "sand-rush", B_RUSH, WX_SAND }, { "slush-rush", B_RUSH, WX_SNOW }, { "run-away", B_SPEED_K, 0, false, 1.08 },
  /* climas (los pone el JS: G.Weather) */
  { "drought", B_NONE }, { "orichalcum-pulse", B_NONE }, { "drizzle", B_NONE }, { "sand-stream", B_NONE }, { "snow-warning", B_NONE },
  { "rain-dish", B_WXHEAL, WX_RAIN, false, 0.015 }, { "ice-body", B_WXHEAL, WX_SNOW, false, 0.015 }, { "dry-skin", B_DRYSKIN },
  /* defensa */
  { "levitate", B_LEVITATE }, { "thick-fat", B_THICKFAT }, { "heatproof", B_IN_TYPE, TY_FIRE, false, 0.5 },
  { "water-absorb", B_ABSORB, TY_WATER }, { "storm-drain", B_ABSORB, TY_WATER }, { "volt-absorb", B_ABSORB, TY_ELECTRIC },
  { "lightning-rod", B_ABSORB, TY_ELECTRIC }, { "motor-drive", B_ABSORB, TY_ELECTRIC }, { "flash-fire", B_ABSORB, TY_FIRE },
  { "well-baked-body", B_ABSORB, TY_FIRE }, { "sap-sipper", B_ABSORB, TY_GRASS }, { "earth-eater", B_ABSORB, TY_GROUND },
  { "multiscale", B_MULTISCALE }, { "shadow-shield", B_MULTISCALE },
  { "filter", B_FILTER }, { "solid-rock", B_FILTER }, { "prism-armor", B_FILTER },
  { "fur-coat", B_IN_CLS, P, false, 0.6 }, { "fluffy", B_IN_CLS, P, false, 0.7 }, { "ice-scales", B_IN_CLS, SP, false, 0.6 },
  { "shell-armor", B_IN_ALL, 0, false, 0.92 }, { "battle-armor", B_IN_ALL, 0, false, 0.92 },
  { "intimidate", B_IN_CLS, P, false, 0.88 }, { "pressure", B_IN_ALL, 0, false, 0.92 }, { "sturdy", B_STURDY },
  { "regenerator", B_NONE }, { "magic-guard", B_LAVAPROOF }, { "stamina", B_STAMINA },
  { "limber", B_STEADY }, { "own-tempo", B_STEADY }, { "oblivious", B_STEADY }, { "inner-focus", B_STEADY },
  { "clear-body", B_STEADY }, { "white-smoke", B_STEADY }, { "full-metal-body", B_STEADY }, { "insomnia", B_STEADY },
  { "vital-spirit", B_STEADY },
  /* contraataques */
  { "static", B_C_SLOW, 0, false, 0.5, 2.5 }, { "flame-body", B_C_BURN, 0, false, 2 }, { "poison-point", B_C_POISON, 0, false, 2 },
  { "cute-charm", B_C_SLOW, 0, false, 0.4, 2.5 }, { "effect-spore", B_SPORE }, { "rough-skin", B_ROUGH }, { "iron-barbs", B_ROUGH },
  { "poison-touch", B_TOUCHPOISON },
  /* botín (el JS) */
  { "pickup", B_NONE }, { "honey-gather", B_NONE },
  /* intercambios */
  { "truant", B_ALL_K, 0, false, 1.35 }, { "slow-start", B_SLOWSTART }, { "defeatist", B_DEFEATIST }, { "wonder-guard", B_WONDER },
  { "schooling", B_SCHOOLING }, { "zen-mode", B_ZEN, 0, true }, { "stance-change", B_STANCE }, { "imposter", B_NONE },
  /* genéricas (plus: suman la pasiva de su tipo) */
  { "keen-eye", B_NONE, 0, true }, { "frisk", B_NONE, 0, true }, { "magnet-pull", B_NONE, 0, true },
  { "sticky-hold", B_NONE, 0, true }, { "illuminate", B_NONE, 0, true },
  { "sand-veil", B_DODGE_WX, WX_SAND, true, 0.15 }, { "snow-cloak", B_DODGE_WX, WX_SNOW, true, 0.15 },
  { "gluttony", B_HEALMUL, 0, true, 1.4 }, { "harvest", B_HEALMUL, 0, true, 1.3 }, { "unnerve", B_IN_ALL, 0, true, 0.94 },
  { "infiltrator", B_INFILTRATOR, 0, true }, { "telepathy", B_DODGE, 0, true, 0.08 }, { "anticipation", B_DODGE, 0, true, 0.06 },
  { "forewarn", B_DODGE, 0, true, 0.06 }, { "weak-armor", B_WEAKARMOR, 0, true }, { "steadfast", B_STEADFAST, 0, true },
  { "rattled", B_RATTLED, 0, true }, { "hydration", B_HYDRATION, 0, true }, { "overcoat", B_IN_CLS, SP, true, 0.95 },
  { "shed-skin", B_SHEDSKIN, 0, true }, { "natural-cure", B_NONE, 0, true }, { "healer", B_NONE, 0, true },
  { "leaf-guard", B_LEAFGUARD, 0, true }, { "mold-breaker", B_MOLD, 0, true }, { "damp", B_DAMP, 0, true },
  { "rivalry", B_RIVALRY, 0, true }, { "synchronize", B_SYNCHRO, 0, true }, { "prankster", B_PRANKSTER, 0, true },
  { "early-bird", B_STEADY, 0, true }, { "shield-dust", B_STEADY, 0, true }, { "sweet-veil", B_STEADY, 0, true },
  { "unburden", B_UNBURDEN, 0, true }, { "unaware", B_IN_ALL, 0, true, 0.92 }, { "defiant", B_DEFIANT, P, true },
  { "competitive", B_DEFIANT, SP, true }, { "soundproof", B_IN_CLS, SP, true, 0.9 }, { "big-pecks", B_IN_CLS, P, true, 0.92 },
  { "water-veil", B_WATERVEIL, 0, true }, { "pickpocket", B_PICKPOCKET, 0, true }, { "analytic", B_ANALYTIC, 0, true },
  { "klutz", B_KLUTZ, 0, true }, { "hyper-cutter", B_PHYS_K, 0, true, 1.06 }, { "contrary", B_SLOWSPEED, 0, true, 2.4 },
  { "quick-feet", B_SLOWSPEED, 0, true, 2.5 }, { "bulletproof", B_IN_CLS, SP, true, 0.85 }, { "magic-bounce", B_MAGICBOUNCE, 0, true },
  { "friend-guard", B_IN_ALL, 0, true, 0.94 }, { "stench", B_STENCH, 0, true }, { "anger-point", B_ANGER },
  { "justified", B_JUSTIFIED, 0, true }, { "cursed-body", B_CURSED }, { "plus", B_SPEC_K, 0, false, 1.1 },
  { "minus", B_SPEC_K, 0, false, 1.1 }, { "no-guard", B_NOGUARD }, { "aftermath", B_AFTERMATH, 0, true },
  { "moody", B_MOODY, 0, true }, { "tangled-feet", B_TANGLED, 0, true }, { "skill-link", B_SKILLLINK, 0, true },
  { "protosynthesis", B_PROTO, 0, true },
};
#undef P
#undef SP
#define NROWS ((int)(sizeof ROWS / sizeof *ROWS))
enum { MOOD_ATK = 1, MOOD_SPA, MOOD_SPD, MOOD_DEF };

int abil_find(const char *id) {
  if (id) for (int i = 0; i < NROWS; i++) if (!strcmp(ROWS[i].id, id)) return i;
  return -1;
}
void player_set_ability(Player *p, int ab, int type0) {
  p->ab = ab >= 0 && ab < NROWS ? ab : -1; p->abType = type0;
  p->moxie = p->boostT = p->abSpd = p->ssT = p->stanceT = p->moodT = p->shedT = 0;
  p->shieldForm = p->angry = p->boomed = false; p->mood = 0;
}
static inline const Row *row(const Player *p) { return p->ab >= 0 ? &ROWS[p->ab] : NULL; }
static inline int B(const Player *p) { return p->ab >= 0 ? ROWS[p->ab].b : B_NONE; }

/* ---------------- clima (G.Weather) ---------------- */
int sim_wx(void) { return S.wxLv > 0 ? S.wx : WX_NONE; }   /* (G.Weather.current || {}).kind */
double wx_mult(int type) {
  double m = 1;
  switch (S.wx) {
    case WX_SUN: m = type == TY_FIRE ? 1.5 : type == TY_WATER ? 0.5 : 1; break;
    case WX_RAIN: m = type == TY_WATER ? 1.5 : type == TY_ELECTRIC ? 1.2 : type == TY_FIRE ? 0.5 : 1; break;
    case WX_SAND: m = type == TY_ROCK || type == TY_GROUND || type == TY_STEEL ? 1.3 : 1; break;
    case WX_SNOW: m = type == TY_ICE ? 1.5 : 1; break;
    case WX_FOG: m = type == TY_GHOST || type == TY_FAIRY || type == TY_PSYCHIC ? 1.3 : 1; break;
  }
  return m != 1 ? 1 + (m - 1) * S.wxLv : 1;
}
double wx_speed(uint32_t types) { return S.wx == WX_SNOW && !(types & 1u << TY_ICE) ? 1 - 0.1 * S.wxLv : 1; }

/* ---------------- ganchos ---------------- */
static inline bool low(const Player *p) { return p->hp < p->maxHp / 3; }
static inline bool half(const Player *p) { return p->hp < p->maxHp / 2; }
static inline int mcls(const PMove *m) { const int c = core_moves[m->def].cat; return c == CAT_PHYS ? 'p' : c == CAT_SPEC ? 's' : 0; }
static inline bool super_eff(const Player *p, int type) { return type >= 0 && type_mult(type, p->types) > 1; }
static void heal_k(Player *p, double k) { p->hp = fmin(p->maxHp, p->hp + p->maxHp * k); }   /* (sin ×cura ni número) */
static bool by_name(int pat, const char *id) {
  static const char *const PAT[][8] = {
    [N_PUNCH] = { "punch" }, [N_JAW] = { "bite", "fang", "crunch", "jaw" }, [N_PULSE] = { "pulse", "aura-sphere" },
    [N_CUT] = { "cut", "slash", "blade", "razor", "scissor", "sword" },
    [N_SOUND] = { "voice", "buzz", "boom", "noise", "sing", "echo", "uproar", "snarl" },
  };
  for (int i = 0; i < 8 && PAT[pat][i]; i++) if (strstr(id, PAT[pat][i])) return true;
  return false;
}

int abil_flags(const Player *p) {
  switch (B(p)) {
    case B_STEADY: return AF_STEADY;
    case B_LEVITATE: return AF_LEVITATE;
    case B_LAVAPROOF: return AF_LAVAPROOF | AF_TRAPPROOF;   /* (Muro Mágico) */
    case B_WATERVEIL: return AF_LAVAPROOF;
    case B_STURDY: return AF_STURDY;
    case B_SHEER: return AF_SHEER;
    case B_SERENE: return AF_SERENE;
    case B_DAMP: return AF_DAMP;
    case B_TOUCHPOISON: return AF_TOUCHPOISON;
  }
  return 0;
}

static double out_of(Player *p, const Row *r, const PMove *m, const Enemy *e) {
  const MoveDef *d = &core_moves[m->def];
  const MoveStat *s = pm_stat(m);
  const int c = mcls(m), wx = sim_wx();
  switch (r->b) {
    case B_PINCH: return d->type == r->t && low(p) ? 1.35 : 1;
    case B_BOOST: return d->type == r->t ? 1.2 : 1;
    case B_NAME: return by_name(r->t, d->id) ? r->k : 1;
    case B_WATERBUBBLE: return d->type == TY_WATER ? 1.4 : 1;
    case B_TECH: return d->lv[0].dmg > 0 && d->lv[0].dmg <= 12 ? 1.35 : 1;   /* (sin daño: los potenciadores) */
    case B_PHYS_K: return c == 'p' ? r->k : 1;
    case B_HUSTLE: return c != 'p' ? 1 : rng_next(&S.rng) < 1.0 / 6 ? 0.3 : 1.25;
    case B_GUTS: return c == 'p' && half(p) ? 1.3 : 1;
    case B_ADAPT: return p->types & 1u << d->type ? 1.25 : 1;
    case B_ALL_K: return r->k;
    case B_SHEER: return s->burn || s->poison || s->slow || s->knock ? 1.25 : 1;
    case B_TOUGH: return d->kind == MK_MELEE || d->kind == MK_DASH ? 1.25 : 1;
    case B_RECKLESS: return d->kind == MK_DASH ? 1.25 : 1;
    case B_TINTED: { const double k = e ? type_mult(d->type, e->types) : 1; return k < 1 && k > 0 ? 1 / k : 1; }
    case B_SCRAPPY:
      return (d->type == TY_NORMAL || d->type == TY_FIGHTING) && e && e->types & 1u << TY_GHOST ? 1 / fmax(0.3, type_mult(d->type, e->types)) : 1;
    case B_SANDFORCE: return wx == WX_SAND && (d->type == TY_ROCK || d->type == TY_GROUND || d->type == TY_STEEL) ? 1.3 : 1;
    case B_SOLAR: return wx == WX_SUN && c == 's' ? 1.4 : 1;
    case B_MOXIE: return 1 + p->moxie;
    case B_SLOWSTART: return p->ssT < 60 ? 0.6 : 1;
    case B_DEFEATIST: return half(p) ? 0.75 : 1.15;
    case B_SCHOOLING: return p->hp > p->maxHp / 4 ? 1.5 : 1;
    case B_ZEN: return half(p) && c == 's' ? 1.3 : 1;
    case B_STANCE: return p->shieldForm ? 1 : 1.2;
    case B_MOLD: return e && e->boss ? 1.12 : 1;
    case B_RIVALRY: return e && e->types & p->types ? 1.15 : 1;
    case B_DEFIANT: return p->slowT > 0 && c == r->t ? 1.2 : 1;
    case B_ANALYTIC: return e && e->hp < e->maxHp * 0.5 ? 1.15 : 1;
    case B_KLUTZ: return p->item >= 0 ? 1 : 1.12;
    case B_SPEC_K: return c == 's' ? r->k : 1;
    case B_NOGUARD: return 1.15;
    case B_ANGER: return p->angry ? 1.25 : 1;
    case B_JUSTIFIED: return e && e->types & 1u << TY_DARK ? 1.15 : 1;
    case B_MOODY: return p->mood == (c == 's' ? MOOD_SPA : MOOD_ATK) ? 1.1 : 1;
    case B_SKILLLINK: return (s->count ? s->count : 1) > 2 || s->bounce ? 1.25 : 1;
    case B_PROTO: return wx == WX_SUN ? 1.2 : 1;
  }
  return 1;
}
double abil_out(Player *p, const PMove *m, const Enemy *e) {
  if (!m) return 1;
  const double g = core_moves[m->def].type == p->abType ? 1.08 : 1;   /* la genérica: +8 % con su tipo principal */
  const Row *r = row(p);
  if (!r) return g;
  const double v = out_of(p, r, m, e);
  return r->plus ? v * g : v;
}

double abil_in(const Player *p, int type, int cls) {
  const Row *r = row(p);
  if (!r) return 1;
  switch (r->b) {
    case B_WATERBUBBLE: case B_WATERVEIL: return type == TY_FIRE ? 0.5 : 1;
    case B_DRYSKIN: return type == TY_FIRE ? 1.25 : 1;
    case B_LEVITATE: return type == TY_GROUND ? 0.3 : 1;
    case B_THICKFAT: return type == TY_FIRE || type == TY_ICE ? 0.6 : 1;
    case B_IN_TYPE: return type == r->t ? r->k : 1;
    case B_MULTISCALE: return p->hp >= p->maxHp * 0.95 ? 0.5 : 1;
    case B_FILTER: return super_eff(p, type) ? 0.75 : 1;
    case B_IN_CLS: return cls == r->t ? r->k : 1;
    case B_IN_ALL: return r->k;
    case B_STANCE: return p->shieldForm ? 0.8 : 1;
    case B_WONDER: return super_eff(p, type) ? 1.5 : 0.35;
    case B_LEAFGUARD: return sim_wx() == WX_SUN ? 0.85 : 1;
    case B_MAGICBOUNCE: return cls == 's' ? 0.85 : 1;
    case B_NOGUARD: return 1.1;
    case B_MOODY: return p->mood == MOOD_DEF ? 0.9 : 1;
  }
  return 1;
}
int abil_absorb(const Player *p) { const int b = B(p); return b == B_ABSORB ? ROWS[p->ab].t : b == B_DRYSKIN ? TY_WATER : -1; }
bool abil_has_dodge(const Player *p) { const int b = B(p); return b == B_DODGE_WX || b == B_DODGE || b == B_MAGICBOUNCE || b == B_TANGLED; }
double abil_dodge(const Player *p, int type, int cls) {
  (void)type;
  const Row *r = row(p);
  switch (B(p)) {
    case B_DODGE_WX: return sim_wx() == r->t ? r->k : 0;
    case B_DODGE: return r->k;
    case B_MAGICBOUNCE: return cls == 's' ? 0.1 : 0;
    case B_TANGLED: return p->slowT > 0 ? 0.2 : 0;
  }
  return 0;
}
double abil_speed(const Player *p) {
  const Row *r = row(p);
  switch (B(p)) {
    case B_SPEEDBOOST: return 1 + p->abSpd;
    case B_RUSH: return sim_wx() == r->t ? 1.5 : 1;
    case B_SPEED_K: return r->k;
    case B_SLOWSTART: return p->ssT < 60 ? 0.8 : 1;
    case B_UNBURDEN: return p->item >= 0 ? 1 : 1.15;
    case B_SLOWSPEED: return p->slowT > 0 ? r->k : 1;
    case B_MOODY: return p->mood == MOOD_SPD ? 1.1 : 1;
  }
  return 1;
}
double abil_heal_mul(const Player *p) { return B(p) == B_HEALMUL ? ROWS[p->ab].k : 1; }
double abil_status_cd(const Player *p) { return B(p) == B_PRANKSTER ? 0.7 : 1; }
double abil_crit_mul(const Player *p) { return B(p) == B_SNIPER ? 2 : 1.5; }

static inline int who_of(const Player *p) { return (int)(p - S.pl); }

void abil_hurt(Player *p, int type, int cls) {
  switch (B(p)) {
    case B_WEAKARMOR: if (cls == 'p') add_buff(p, BF_SPD, 0.2, 3, 1); break;
    case B_STEADFAST: add_buff(p, BF_SPD, 0.1, 3, 2); break;
    case B_RATTLED: if (type == TY_BUG || type == TY_GHOST || type == TY_DARK) add_buff(p, BF_SPD, 0.25, 4, 1); break;
    case B_PICKPOCKET:
      if (rng_next(&S.rng) < 0.12) {
        const double x = p->x + rng_range(&S.rng, -10, 10), y = p->y + rng_range(&S.rng, -10, 10);
        pickup_drop(PK_COIN, x, y, 2);
      }
      break;
  }
}
void abil_contact(Player *p, Enemy *e) {
  const Row *r = row(p);
  switch (B(p)) {
    case B_STAMINA: add_buff(p, BF_DEF, 0.03, 6, 5); break;
    case B_C_SLOW: apply_slow(e, r->k, r->k2); break;
    case B_C_BURN: apply_burn(e, r->k); break;
    case B_C_POISON: apply_poison(e, r->k); break;
    case B_SPORE: if (rng_next(&S.rng) < 0.5) apply_slow(e, 0.45, 2.5); else apply_poison(e, 2); break;
    case B_ROUGH: enemy_hurt(e, 10 + p->level * 3, 0, 0, 0, who_of(p)); break;
    case B_SYNCHRO: enemy_hurt(e, 6 + p->level * 2, 0, 0, 0, who_of(p)); break;
    case B_CURSED: if (rng_next(&S.rng) < 0.3) apply_slow(e, 0.5, 2); break;
  }
}
void abil_hit(Player *p, Enemy *e, const PMove *m) {   /* Combat.afterHit */
  if (e->dead) return;
  switch (B(p)) {
    case B_INFILTRATOR: if (e->shield > 0) { e->shield = 0; e->shieldT = 0; } break;
    case B_STENCH: if (rng_next(&S.rng) < 0.1) apply_slow(e, 0.35, 1.5); break;
  }
  if (abil_flags(p) & AF_TOUCHPOISON && m && (core_moves[m->def].kind == MK_MELEE || core_moves[m->def].kind == MK_DASH)) apply_poison(e, 1);
}
void abil_kill(Player *p, const Enemy *e) {
  (void)e;
  if (B(p) == B_MOXIE) p->moxie = fmin(0.15, p->moxie + 0.005);
}
void abil_tick(Player *p, double dt) {
  const Row *r = row(p);
  const int wx = sim_wx(), who = who_of(p);
  switch (B(p)) {
    case B_SOLAR: if (wx == WX_SUN && p->hp > p->maxHp * 0.1) p->hp -= p->maxHp * 0.004 * dt; break;
    case B_SPEEDBOOST: p->boostT += dt; if (p->boostT >= 10) { p->boostT = 0; p->abSpd = fmin(0.3, p->abSpd + 0.015); } break;
    case B_WXHEAL: if (wx == r->t) heal_k(p, r->k * dt); break;
    case B_DRYSKIN: if (wx == WX_RAIN) heal_k(p, 0.012 * dt); break;
    case B_SLOWSTART: p->ssT += dt; break;
    case B_STANCE: p->stanceT += dt; if (p->stanceT >= 8) { p->stanceT = 0; p->shieldForm = !p->shieldForm; } break;
    case B_HYDRATION: if (wx == WX_RAIN) { heal_k(p, 0.01 * dt); p->slowT = 0; } break;
    case B_SHEDSKIN: p->shedT += dt; if (p->shedT >= 5) { p->shedT = 0; p->slowT = 0; heal_k(p, 0.02); } break;
    case B_LEAFGUARD: if (wx == WX_SUN) p->slowT = 0; break;
    case B_ANGER: if (!p->angry && half(p)) { p->angry = true; sim_event(EV_FX, who, FX_ANGRY, p->x, p->y, 0, 0, 0); } break;
    case B_AFTERMATH: {
      if (p->boomed || p->hp >= p->maxHp * 0.2 || p->dead) break;
      p->boomed = true;
      sim_event(EV_FX, who, FX_BOOM, p->x, p->y, 140, 0, 0);
      int in[MAXEN]; const int n = sim_query_circle(p->x, p->y, 140, in, MAXEN);
      for (int i = 0; i < n; i++) { Enemy *e = &S.en[in[i]]; enemy_hurt(e, 40 + p->level * 10, e->x - p->x, e->y - p->y, 160, who); }
      break;
    }
    case B_MOODY:
      p->moodT -= dt;
      if (p->moodT > 0) break;
      p->moodT = 10; p->mood = MOOD_ATK + rng_int(&S.rng, 0, 3);
      sim_event(EV_FX, who, FX_MOOD, p->x, p->y, p->mood, 0, 0);
      break;
  }
}

/* ---------------- esferas (G.Orbs): 4 huecos, hasta 3 de cada, 1 s entre una y otra ---------------- */
#define ORB_STACK 3
#define ORB_NEAR 384.0                 /* media pantalla: las mejoras llegan a los compañeros a menos de esto */
#define ORB_PUSH 1700.0
#define ORB_PUSH_R 240.0
static const double ORB_DUR[ORB_N] = { [ORB_FOCUS] = 15, [ORB_LUMINOUS] = 15, [ORB_QUICK] = 10 };

bool orb_can_take(const Player *p, int id) {
  bool room = false;
  for (int i = 0; i < ORB_SLOTS; i++) {
    if (p->orbId[i] == id) return p->orbN[i] < ORB_STACK;
    room |= p->orbId[i] < 0;
  }
  return room;
}
bool orb_add(Player *p, int id) {
  if (id < 0 || id >= ORB_N || !orb_can_take(p, id)) return false;
  for (int i = 0; i < ORB_SLOTS; i++) if (p->orbId[i] == id) { p->orbN[i]++; return true; }
  for (int i = 0; i < ORB_SLOTS; i++) if (p->orbId[i] < 0) { p->orbId[i] = id; p->orbN[i] = 1; return true; }
  return false;
}
bool orb_use(int who, int slot, double hw, double hh) {
  if (who < 0 || who >= S.np || slot < 0 || slot >= ORB_SLOTS) return false;
  Player *p = &S.pl[who];
  const int id = p->orbId[slot];
  if (id < 0 || p->dead) return false;
  if (p->orbCd > 0) { sim_event(EV_FX, who, FX_ORB_CD, p->x, p->y, 0, 0, 0); return false; }
  p->orbCd = 1;
  if (--p->orbN[slot] <= 0) p->orbId[slot] = -1;
  if (id <= ORB_BLOWBACK) {   /* a los enemigos que ve */
    sim_event(EV_ORB, who, id, p->x, p->y, 260, 0, 0);
    for (int i = 0; i < S.ne; i++) {
      Enemy *e = &S.en[i];
      if (e->dead) continue;
      const double dx = e->x - p->x, dy = e->y - p->y;
      const bool big = e->boss || e->legend || e->judge;
      if (id == ORB_BLOWBACK) {
        if (dx * dx + dy * dy > ORB_PUSH_R * ORB_PUSH_R) continue;
        double nx, ny;
        u_norm(dx ? dx : 1, dy, &nx, &ny);
        e->kx += nx * ORB_PUSH * (big ? 0.5 : 1); e->ky += ny * ORB_PUSH * (big ? 0.5 : 1);
        continue;
      }
      if (fabs(dx) > hw || fabs(dy) > hh) continue;
      if (id == ORB_SLUMBER) { if (!e->judge) e->sleepT = fmax(e->sleepT, big ? 1 : 4); }
      else apply_slow(e, big ? 0.2 : 0.5, 8);
    }
  } else {   /* mejora: para él y los compañeros a menos de media pantalla */
    sim_event(EV_ORB, who, id, p->x, p->y, ORB_NEAR, 0, 0);
    for (int k = 0; k < S.np; k++) {
      Player *o = &S.pl[k];
      if (!o->on || o->dead || (k != who && u_dist2(o->x, o->y, p->x, p->y) >= ORB_NEAR * ORB_NEAR)) continue;
      o->orbT[id] = ORB_DUR[id];
    }
  }
  return true;
}
void orb_update(Player *p, double dt) {
  if (p->orbCd > 0) p->orbCd -= dt;
  for (int i = 0; i < ORB_N; i++) if (p->orbT[i] > 0) p->orbT[i] -= dt;
}
