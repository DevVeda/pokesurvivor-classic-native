/* world.c — el mapa de la partida: G.World de js/app.js (L11010) sin el dibujo.
 * Terreno por tile con ruido de valor y semilla, objetos del escenario, consultas y choques. Mismo resultado que el JS
 * (banco: core/bench-world.cjs). El botín al romper un objeto lo pone quien llama (con el *gone de world_damage_prop).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include "core.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define N WORLD_N
#define TS WORLD_TS
#define CW WORLD_CW

static int32_t seed = 1;
static int biome = 0;
static bool hw_on, hw_run;
static struct { bool on; double tx, ty, r; const ArenaTheme *th; } arena;
static int next_prop_id = 1;

/* ---------------- ruido ---------------- */

static inline int32_t i32(double v) { return (int32_t)(int64_t)v; }   /* (v | 0) del JS, para lo que cabe en 32 bits */
static inline double H(double x, double y, double s) { return core_hash(i32(x), i32(y), i32(s)); }

static double vnoise(double x, double y, double s) {
  const double xi = floor(x), yi = floor(y);
  const double xf = x - xi, yf = y - yi;
  const double u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const double a = H(xi, yi, s), b = H(xi + 1, yi, s), c = H(xi, yi + 1, s), d = H(xi + 1, yi + 1, s);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
static double fbm(double x, double y, double s) {
  return vnoise(x, y, s) * 0.65 + vnoise(x * 2.13 + 17, y * 2.13 - 9, s + 1) * 0.35;
}
/* Math.hypot del JS: con enteros (y los umbrales del mapa) sqrt da lo mismo. */
static inline double hyp(double x, double y) { return sqrt(x * x + y * y); }
static inline double clamp(double v, double a, double b) { return v < a ? a : v > b ? b : v; }
static inline double dist2(double ax, double ay, double bx, double by) { const double dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }

/* ---------------- terreno ---------------- */

static double arena_dist(double tx, double ty) { return arena.on ? hyp(tx - arena.tx, ty - arena.ty) : INFINITY; }
static double arena_outer(void) { return arena.on ? arena.r + 7 : 0; }

/* Pasillo libre de la arena (sur: vosotros, norte: el legendario) y el claro de Arceus. */
static bool arena_safe(double tx, double ty) {
  const double lx = tx - arena.tx, ly = ty - arena.ty;
  return (fabs(lx) <= 2 && ly >= -6 && ly <= 5) || hyp(lx, ly) < 2.5 ||
         (arena.th->clear > 0 && hyp(lx, ly + 5) < arena.th->clear);
}

static int terrain_raw(int32_t tx, int32_t ty) {
  const double ad = arena_dist(tx, ty);
  if (ad < arena_outer()) {
    if (ad >= arena.r) return TER_WALL;
    if (arena_safe(tx, ty)) return TER_FLOOR;
    const ArenaTheme *th = arena.th;
    if (th->pillars && ad < arena.r - 2 && H(tx >> 1, ty >> 1, seed + 31 + arena.tx) < th->pillars) return TER_WALL;
    if (th->pools && ad < arena.r - 1.5 && fbm(tx / 3.2, ty / 3.2, seed + 37 + arena.tx) < th->pools) return TER_LIQUID;
    return TER_FLOOR;
  }
  const double d = hyp(tx, ty);
  if (d < 9) return TER_FLOOR;
  const double ramp = clamp((d - 9) / 8, 0, 1);
  if (fbm(tx / 13.0, ty / 13.0, seed + 101) < 0.04 + 0.23 * ramp) return TER_LIQUID;
  if (fbm(tx / 8.0, ty / 8.0, seed + 202) > 1 - 0.27 * ramp) return TER_WALL;
  return TER_FLOOR;
}

/* ---------------- objetos rotos (casillas) ---------------- */

static struct { uint64_t *k; size_t n, cap; } broken;   /* conjunto abierto; clave 0 = vacío */
static inline uint64_t tkey(int32_t tx, int32_t ty) { return ((uint64_t)(uint32_t)tx << 32 | (uint32_t)ty) + 1; }
static size_t bslot(uint64_t k) { return (size_t)((k * 0x9E3779B97F4A7C15ull) >> 20) & (broken.cap - 1); }
static bool broken_has(int32_t tx, int32_t ty) {
  if (!broken.cap) return false;
  const uint64_t k = tkey(tx, ty);
  for (size_t i = bslot(k);; i = (i + 1) & (broken.cap - 1)) { if (broken.k[i] == k) return true; if (!broken.k[i]) return false; }
}
static void broken_add(int32_t tx, int32_t ty) {
  if (broken_has(tx, ty)) return;
  if ((broken.n + 1) * 2 > broken.cap) {   /* crece al 50% */
    const size_t oc = broken.cap; uint64_t *ok = broken.k;
    broken.cap = oc ? oc * 2 : 1024; broken.k = calloc(broken.cap, sizeof *broken.k);
    for (size_t j = 0; j < oc; j++) if (ok[j]) { size_t i = bslot(ok[j]); while (broken.k[i]) i = (i + 1) & (broken.cap - 1); broken.k[i] = ok[j]; }
    free(ok);
  }
  const uint64_t k = tkey(tx, ty);
  size_t i = bslot(k); while (broken.k[i]) i = (i + 1) & (broken.cap - 1);
  broken.k[i] = k; broken.n++;
}

/* ---------------- trozos ---------------- */

/* ponytail: caché directa de 32×32 trozos (16 384 px de lado): dos trozos sólo comparten hueco a esa distancia, y entonces
 * se rehace (el terreno sale igual; los objetos dañados vuelven enteros, como en el JS al pasar de MAX_DATA). */
#define CSIDE 32
typedef struct { bool live; int32_t cx, cy; uint8_t terr[N * N]; int16_t prop_at[N * N]; Prop *props; int np, cap; } Chunk;
static Chunk chunks[CSIDE * CSIDE];

static const struct { bool solid, flat; double hp, r; } PROP[PROP_N] = {
  [PROP_TREE] = { true, false, INFINITY, 13 }, [PROP_ROCK] = { true, false, 34, 12 }, [PROP_CHEST] = { true, false, 22, 12 },
  [PROP_PUMPKIN] = { true, false, 26, 11 }, [PROP_GRASS] = { false, false, 1, 14 }, [PROP_ALTAR] = { true, false, INFINITY, 9 },
  [PROP_SPRING] = { false, true, INFINITY, 22 }, [PROP_BIGCHEST] = { true, false, INFINITY, 14 }, [PROP_TRAP] = { false, true, INFINITY, 9 },
};
static inline bool special(int t) { return t == PROP_ALTAR || t == PROP_SPRING || t == PROP_BIGCHEST || t == PROP_TRAP; }

static void add_prop(Chunk *c, int type, int32_t tx, int32_t ty, int kind) {
  if (c->np == c->cap) { c->cap = c->cap ? c->cap * 2 : 16; c->props = realloc(c->props, c->cap * sizeof *c->props); }
  c->props[c->np] = (Prop){ .id = next_prop_id++, .type = type, .tx = tx, .ty = ty, .kind = kind,
    .x = tx * TS + TS / 2, .y = ty * TS + TS - 4, .r = PROP[type].r, .hp = PROP[type].hp, .maxHp = PROP[type].hp,
    .solid = PROP[type].solid, .flat = PROP[type].flat, .destructible = PROP[type].hp != INFINITY, .charge = 1 };
  if (PROP[type].solid) c->prop_at[(ty - c->cy * N) * N + (tx - c->cx * N)] = (int16_t)c->np;
  c->np++;
}

static void place_props(Chunk *c) {
  const bool menu_hw = seed == WORLD_MENU_SEED && hw_on;
  for (int j = 0; j < N; j++) for (int i = 0; i < N; i++) {
    if (c->terr[j * N + i] != TER_FLOOR) continue;
    const int32_t tx = c->cx * N + i, ty = c->cy * N + j;
    if (hyp(tx, ty) < 7 && !menu_hw) continue;
    if (broken_has(tx, ty)) continue;
    bool open = true;   /* suelo alrededor: nada pegado a paredes ni agua */
    for (int b = -1; b <= 1 && open; b++) for (int a = -1; a <= 1; a++) if (terrain_raw(tx + a, ty + b) != TER_FLOOR) { open = false; break; }
    if (hyp(tx, ty) < 7) {   /* (sólo el menú de Halloween llega aquí) */
      if (open && H(tx, ty, seed + 404) > 0.96) add_prop(c, PROP_PUMPKIN, tx, ty, 0);
      continue;
    }
    const double ad = arena_dist(tx, ty);
    if (ad < arena_outer() + 2) {
      if (!arena.on || ad >= arena.r - 1.2 || arena_safe(tx, ty)) continue;
      const ArenaTheme *th = arena.th;
      const double hh = H(tx, ty, seed + 777);
      int at = -1;
      if (open && hh < th->tree) at = PROP_TREE;
      else if (open && hh < th->tree + th->rock) at = PROP_ROCK;
      else if (hh > 1 - th->grass) at = PROP_GRASS;
      if (at >= 0) add_prop(c, at, tx, ty, 0);
      continue;
    }
    const double h = H(tx, ty, seed + 404);
    const bool grove = fbm(tx / 10.0, ty / 10.0, seed + 505) > 0.6;
    int type = -1, kind = 0;
    const double hs = H(tx, ty, seed + 909);
    if (open && hyp(tx, ty) > 12 && hs < 0.0032) {
      type = hs < 0.0004 ? PROP_ALTAR : hs < 0.0008 ? PROP_SPRING : hs < 0.0011 ? PROP_BIGCHEST : PROP_TRAP;
      kind = (int)floor(H(tx, ty, seed + 910) * (type == PROP_ALTAR ? 4 : 3));
    }
    if (type >= 0) {}
    else if (open && h < (grove ? 0.07 : 0.006)) type = PROP_TREE;
    else if (open && h > 0.992) type = PROP_ROCK;
    else if (open && h > (menu_hw ? 0.955 : 0.972) && h <= 0.985 && hw_run) type = PROP_PUMPKIN;
    else if (open && h > 0.985 && h <= 0.992 && H(tx, ty, seed + 606) < 0.07) type = PROP_CHEST;
    else if (fbm(tx / 5.0, ty / 5.0, seed + 707) > 0.66 && H(tx, ty, seed + 808) < 0.75) type = PROP_GRASS;
    if (type >= 0) add_prop(c, type, tx, ty, kind);
  }
}

static Chunk *chunk(int32_t cx, int32_t cy) {
  Chunk *c = &chunks[(cy & (CSIDE - 1)) * CSIDE + (cx & (CSIDE - 1))];
  if (c->live && c->cx == cx && c->cy == cy) return c;
  c->live = true; c->cx = cx; c->cy = cy; c->np = 0;
  memset(c->prop_at, -1, sizeof c->prop_at);
  for (int j = 0; j < N; j++) for (int i = 0; i < N; i++) c->terr[j * N + i] = (uint8_t)terrain_raw(cx * N + i, cy * N + j);
  place_props(c);
  return c;
}
static inline int32_t fdiv(int32_t a, int32_t b) { return (int32_t)floor((double)a / b); }   /* Math.floor(a / b) */
static inline int32_t tile_of(double v) { return (int32_t)floor(v / TS); }

int world_terrain(int32_t tx, int32_t ty) {
  const int32_t cx = fdiv(tx, N), cy = fdiv(ty, N);
  return chunk(cx, cy)->terr[(ty - cy * N) * N + (tx - cx * N)];
}
Prop *world_prop_at(int32_t tx, int32_t ty) {
  const int32_t cx = fdiv(tx, N), cy = fdiv(ty, N);
  Chunk *c = chunk(cx, cy);
  const int k = c->prop_at[(ty - cy * N) * N + (tx - cx * N)];
  return k < 0 ? NULL : &c->props[k];
}

const Prop *world_chunk_props(int32_t cx, int32_t cy, int *n) { Chunk *c = chunk(cx, cy); *n = c->np; return c->props; }

/* ---------------- control ---------------- */

void world_reset(int32_t s) {
  seed = s ? s : 1;
  for (int i = 0; i < CSIDE * CSIDE; i++) chunks[i].live = false;
  if (broken.cap) memset(broken.k, 0, broken.cap * sizeof *broken.k);
  broken.n = 0;
  arena.on = false;
}
void world_halloween(bool on, bool in_run) { hw_on = on; hw_run = in_run; }
bool world_halloween_run(void) { return hw_run; }
void world_set_biome(int i) { biome = ((i % core_n_biomes) + core_n_biomes) % core_n_biomes; }
int world_biome(void) { return biome; }
int world_liquid(void) { return core_biome_liquid[biome]; }

void world_set_arena(double tx, double ty, double r, int theme) {
  arena.on = r > 0;
  if (!arena.on) return;
  arena.tx = tx; arena.ty = ty; arena.r = r;
  arena.th = &core_arena_themes[theme >= 0 && theme < core_n_arenas ? theme : 0];
  const double R = r + 9;   /* olvida los trozos de esa zona */
  for (int i = 0; i < CSIDE * CSIDE; i++) {
    Chunk *c = &chunks[i];
    if (c->live && fabs(c->cx * N + N / 2 - tx) < R + N && fabs(c->cy * N + N / 2 - ty) < R + N) c->live = false;
  }
}

/* ---------------- consultas ---------------- */

static const struct { LiqFx fx; uint32_t immune; } LIQ[] = {
  [LIQ_WATER]  = { { .slow = 0.6 }, 1u << TY_WATER },
  [LIQ_SWAMP]  = { { .slow = 0.45 }, 1u << TY_WATER },
  [LIQ_LAVA]   = { { .dmg = 0.06, .flat = 5, .every = 0.5 }, 1u << TY_FIRE },
  [LIQ_POISON] = { { .dmg = 0.035, .flat = 3, .every = 0.5 }, 1u << TY_POISON | 1u << TY_STEEL },
  [LIQ_SPARK]  = { { .dmg = 0.045, .flat = 4, .every = 0.7 }, 1u << TY_ELECTRIC | 1u << TY_GROUND },
  [LIQ_ICE]    = { { .slide = true }, 1u << TY_ICE },
};
LiqFx world_liquid_effect(uint32_t types) {
  const int k = world_liquid();
  return types & LIQ[k].immune ? (LiqFx){ 0 } : LIQ[k].fx;
}

bool world_walkable(int32_t tx, int32_t ty) {
  const int t = world_terrain(tx, ty);
  if (t == TER_WALL) return false;
  if (t == TER_LIQUID && LIQ[world_liquid()].fx.dmg) return false;   /* lava, veneno, descarga */
  const Prop *p = world_prop_at(tx, ty);
  return !(p && p->solid);
}

bool world_is_free(double x, double y, double r, bool allow_liquid) {
  const int32_t t0x = tile_of(x - r), t1x = tile_of(x + r), t0y = tile_of(y - r), t1y = tile_of(y + r);
  for (int32_t ty = t0y; ty <= t1y; ty++) for (int32_t tx = t0x; tx <= t1x; tx++) {
    const int t = world_terrain(tx, ty);
    if (t == TER_WALL || (!allow_liquid && t == TER_LIQUID)) return false;
    const Prop *p = world_prop_at(tx, ty);
    if (p && dist2(x, y, p->x, p->y) < (r + p->r) * (r + p->r)) return false;
  }
  return true;
}

static int props_near(double x, double y, double r, Prop **out, int max, bool specials) {
  int n = 0;
  const int32_t c0x = (int32_t)floor((x - r) / CW), c1x = (int32_t)floor((x + r) / CW);
  const int32_t c0y = (int32_t)floor((y - r) / CW), c1y = (int32_t)floor((y + r) / CW);
  for (int32_t cy = c0y; cy <= c1y; cy++) for (int32_t cx = c0x; cx <= c1x; cx++) {
    Chunk *c = chunk(cx, cy);
    for (int k = 0; k < c->np; k++) {
      Prop *p = &c->props[k];
      if (specials ? !special(p->type) : !p->destructible || p->hp <= 0) continue;
      if (dist2(x, y, p->x, p->y) <= (r + p->r) * (r + p->r) && n < max) out[n++] = p;
    }
  }
  return n;
}
int world_props_in_circle(double x, double y, double r, Prop **out, int max) { return props_near(x, y, r, out, max, false); }
int world_specials_near(double x, double y, double r, Prop **out, int max) { return props_near(x, y, r, out, max, true); }

Prop *world_nearest_breakable(double x, double y, double r) {
  Prop *in[256], *best = NULL;
  double bd = r * r;
  const int n = world_props_in_circle(x, y, r, in, 256);
  for (int i = 0; i < n; i++) {
    if (!in[i]->solid) continue;
    const double d = dist2(x, y, in[i]->x, in[i]->y);
    if (d < bd) { bd = d; best = in[i]; }
  }
  return best;
}

bool world_collide(double *x, double *y, double r) {
  bool hit = false;
  for (int pass = 0; pass < 2; pass++) {
    const int32_t t0x = tile_of(*x - r), t1x = tile_of(*x + r), t0y = tile_of(*y - r), t1y = tile_of(*y + r);
    for (int32_t ty = t0y; ty <= t1y; ty++) for (int32_t tx = t0x; tx <= t1x; tx++) {
      if (world_terrain(tx, ty) == TER_WALL) {
        const double bx0 = tx * TS, by0 = ty * TS, bx1 = bx0 + TS, by1 = by0 + TS;
        const double qx = clamp(*x, bx0, bx1), qy = clamp(*y, by0, by1);
        const double dx = *x - qx, dy = *y - qy, d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;   /* (como el JS: tampoco mira el objeto de esa casilla) */
        hit = true;
        if (d2 > 1e-6) {
          const double d = sqrt(d2);
          *x += dx / d * (r - d); *y += dy / d * (r - d);
        } else {   /* centro dentro: sale por el lado más cercano */
          const double l = *x - bx0, rr = bx1 - *x, u = *y - by0, b = by1 - *y;
          const double m = fmin(fmin(l, rr), fmin(u, b));
          if (m == l) *x = bx0 - r; else if (m == rr) *x = bx1 + r;
          else if (m == u) *y = by0 - r; else *y = by1 + r;
        }
      }
      const Prop *p = world_prop_at(tx, ty);
      if (p && p->solid) {
        const double dx = *x - p->x, dy = *y - p->y, min = r + p->r, d2 = dx * dx + dy * dy;
        if (d2 < min * min) {
          hit = true;
          double d = sqrt(d2); if (!d) d = 0.01;
          *x = p->x + dx / d * min; *y = p->y + dy / d * min;
        }
      }
    }
  }
  return hit;
}

int world_projectile_block(double x, double y, double r, Prop **hit) {
  const int32_t tx = tile_of(x), ty = tile_of(y);
  if (world_terrain(tx, ty) == TER_WALL) return 1;
  for (int b = -1; b <= 1; b++) for (int a = -1; a <= 1; a++) {
    Prop *p = world_prop_at(tx + a, ty + b);
    if (p && p->solid && dist2(x, y, p->x, p->y) < (r + p->r) * (r + p->r)) { if (hit) *hit = p; return 2; }
  }
  return 0;
}

bool world_damage_prop(Prop *p, double amount, Prop *gone) {
  if (!p->destructible || p->hp <= 0) return false;
  p->hp -= amount;
  if (p->hp > 0) return false;
  world_remove_prop(p, gone);
  return true;
}
void world_remove_prop(Prop *p, Prop *gone) {   /* World.breakProp: también los que no se rompen a golpes */
  broken_add(p->tx, p->ty);
  Chunk *c = chunk(fdiv(p->tx, N), fdiv(p->ty, N));
  const int k = (int)(p - c->props);
  if (gone) *gone = *p;
  memmove(&c->props[k], &c->props[k + 1], (c->np - k - 1) * sizeof *c->props);
  c->np--;
  memset(c->prop_at, -1, sizeof c->prop_at);   /* los índices se movieron */
  for (int i = 0; i < c->np; i++) if (c->props[i].solid) c->prop_at[(c->props[i].ty - c->cy * N) * N + (c->props[i].tx - c->cx * N)] = (int16_t)i;
}
