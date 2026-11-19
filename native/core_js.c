/* core_js.c — el núcleo de la partida (core/, ver CORE.md) para el JS: ps.core_*. Lo usa shim/core.js (la prueba de la
 * fase 2: el núcleo mueve a los jugadores y a los enemigos, el JS los pinta).
 *   core_reset(semilla, bioma, halloween, halloweenEnPartida)
 *   core_player(dex, tipos, x, y, radio, velocidad) -> índice (0-3) o -1
 *   core_input(i, ax, ay, aimx, aimy) · core_view(i, radio de su vista)
 *   core_stats(i, …: ver js_stats) · core_learn(i, ataque, nivel, evolucionado) -> bool · core_movelvl(i, ataque, nivel, evo.)
 *   core_dealt(i) -> { ataque: daño }
 *   core_active(i, hueco) · core_slots(i, "ataque,ataque;ataque", hueco activo): los huecos (vínculos) · core_ability(i, habilidad, tipo principal) · core_item(i, objeto: índice de G.Items.LIST o -1)
 *   core_drop(tipo: PickKind, x, y, valor) (pruebas: objetos y esferas salen al azar) ·
 *   core_orb(i, hueco, media vista x, media vista y) -> bool · core_weather(clima: 0 nada, 1 sol… como enum Wx, intensidad)
 *   core_enemy(personalidad, dex, x, y, radio, velocidad, vida, vuela, alcance, recarga, tipos, daño, tipo de golpe,
 *              daño del disparo, disparos en abanico, experiencia, marcas (1 jefe, 2 legendario, 4 Sentencia, 8 shiny,
 *              16 dorado, 32 suelta un ticket ×10, 64 Arceus), zonas, vida del ladrón (s)) -> id o 0
 *   Lo que cambian los sistemas del JS (grieta, Sentencia, eventos), de vuelta: core_ppos(i, x, y) · core_php(i, vida, caído) ·
 *   core_eset(id, x, y, vida, experiencia, dorado) · core_stash() · core_restore() · core_clear(1 disparos | 2 campos | 4 avisos
 *   | 8 suelo) · core_pullall() · core_arena(tx, ty, r, tema) · core_mode(en una arena, Sentencia, ×daño a Arceus, ¿legendarios?)
 *              zonas) -> id o 0
 *   core_biome(i) · core_hazard(tipo 0 zona / 1 rayo, x, y, r, ángulo, largo, ancho, aviso, daño, tipo del golpe, categoría,
 *              % de vida, marcas 1 puro / 2 explosión / 4 pilar) -> id
 *   core_step(dt) · core_events() -> ArrayBuffer de float64, 8 por evento: k, quién, id, x, y, a, b, c (Ev de core.h)
 *   core_state() -> ArrayBuffer de float64 (sim_pack de core.h; ps.CORE_PL y ps.CORE_EN valores por jugador y enemigo)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <math.h>
#include <stdlib.h>
#include "quickjs.h"
#include "core.h"

static double arg(JSContext *ctx, int argc, JSValueConst *argv, int i) {
  double d = 0;
  if (i < argc) JS_ToFloat64(ctx, &d, argv[i]);
  return d;
}
#define A(i) arg(ctx, argc, argv, i)

static JSValue js_reset(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  sim_reset((int32_t)A(0)); world_set_biome((int)A(1)); world_halloween(A(2) != 0, A(3) != 0);
  return JS_UNDEFINED;
}
static JSValue js_player(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  return JS_NewInt32(ctx, sim_add_player((int)A(0), (uint32_t)A(1), A(2), A(3), A(4), A(5)));
}
static JSValue js_input(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  if (i >= 0 && i < S.np) S.pl[i].in = (CoreInput){ A(1), A(2), A(3), A(4), 0 };
  return JS_UNDEFINED;
}
static JSValue js_view(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  if (i >= 0 && i < S.np) S.pl[i].view = A(1);
  return JS_UNDEFINED;
}
static JSValue js_enemy(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int beh = (int)A(0);
  Enemy t = { .beh = beh >= 0 && beh < BEH_N ? beh : BEH_CHASE, .dex = (int)A(1), .x = A(2), .y = A(3), .r = A(4), .spd = A(5),
              .maxHp = A(6), .flying = A(7) != 0, .range = A(8), .shotCd0 = A(9), .types = (uint32_t)A(10), .life = 30,
              .dmg = A(11), .atkType = (int)A(12), .shotDmg = A(13), .fanN = A(14), .xp = A(15),
              .boss = (int)A(16) & 1, .legend = (int)A(16) & 2, .judge = (int)A(16) & 4, .shiny = (int)A(16) & 8, .golden = (int)A(16) & 16,
              .loot10 = (int)A(16) & 32, .arceus = (int)A(16) & 64, .zones = (int)A(17),
              .life = A(18) > 0 ? A(18) : 30 };
  return JS_NewInt32(ctx, sim_add_enemy(&t));
}
/* core_stats(i, vida máx., ×ataque, ×recarga, reducción, crítico, ×velocidad, regeneración, imán, ×experiencia, vida) */
static JSValue js_stats(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  if (i < 0 || i >= S.np) return JS_UNDEFINED;
  Player *p = &S.pl[i];
  if (A(1) > 0) { p->hp = p->hp / p->maxHp * A(1); p->maxHp = A(1); }
  p->atkMul = A(2) > 0 ? A(2) : 1; p->cdMul = A(3) > 0 ? A(3) : 1; p->dmgReduce = A(4); p->critChance = A(5);
  if (argc > 6) { p->spdMul = A(6) > 0 ? A(6) : 1; p->regenFlat = A(7); p->magnet = A(8) > 0 ? A(8) : 78; p->xpMul = A(9) > 0 ? A(9) : 1; }
  if (argc > 10 && A(10) > 0) p->hp = fmin(p->maxHp, A(10));
  if (p->power >= 0) power_apply(p, 1);   /* (el JS no sabe del poder de altar: se vuelve a poner encima) */
  return JS_UNDEFINED;
}
/* core_dealt(i) -> { ataque: daño hecho en esta partida } del jugador i (PMove.dealt): el resumen de la pausa y del final */
static JSValue js_dealt(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  JSValue o = JS_NewObject(ctx);
  if (i >= 0 && i < S.np) {
    const Player *p = &S.pl[i];
    for (int k = 0; k < p->nmv; k++) {
      const char *id = core_moves[p->mv[k].def].id;
      JSValue old = JS_GetPropertyStr(ctx, o, id);
      double prev = 0;
      if (JS_IsNumber(old)) JS_ToFloat64(ctx, &prev, old);
      JS_FreeValue(ctx, old);
      JS_SetPropertyStr(ctx, o, id, JS_NewFloat64(ctx, prev + p->mv[k].dealt));
    }
  }
  return o;
}
/* core_movelvl(i, ataque, nivel, evolucionado): el nivel de uno que ya tiene (cartas de mejora y de evolución) */
static JSValue js_movelvl(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  const char *id = argc > 1 ? JS_ToCString(ctx, argv[1]) : NULL;
  bool ok = false;
  if (id && i >= 0 && i < S.np) {
    Player *p = &S.pl[i];
    const int d = move_find(id);
    for (int k = 0; k < p->nmv; k++) if (p->mv[k].def == d) {
      const int lv = (int)A(2);
      p->mv[k].lvl = lv < 1 ? 1 : lv > core_moves[d].maxLvl ? core_moves[d].maxLvl : lv;
      p->mv[k].evo = A(3) != 0 && core_moves[d].evolves;
      ok = true;
    }
  }
  if (id) JS_FreeCString(ctx, id);
  return JS_NewBool(ctx, ok);
}
static JSValue js_learn(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  const char *id = argc > 1 ? JS_ToCString(ctx, argv[1]) : NULL;
  bool ok = false;
  if (id && i >= 0 && i < S.np) {
    Player *p = &S.pl[i];
    if ((ok = player_learn(p, move_find(id), (int)A(2)))) p->mv[p->nmv - 1].evo = A(3) != 0;
  }
  if (id) JS_FreeCString(ctx, id);
  return JS_NewBool(ctx, ok);
}
static JSValue js_active(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  if (i >= 0 && i < S.np) player_set_active(&S.pl[i], (int)A(1));
  return JS_UNDEFINED;
}
static JSValue js_ability(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  const char *id = argc > 1 ? JS_ToCString(ctx, argv[1]) : NULL;
  if (i >= 0 && i < S.np) player_set_ability(&S.pl[i], abil_find(id), (int)A(2));
  if (id) JS_FreeCString(ctx, id);
  return JS_UNDEFINED;
}
static JSValue js_item(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0), it = (int)A(1);
  if (i >= 0 && i < S.np) S.pl[i].item = it >= 0 && it < IT_N ? it : -1;
  return JS_UNDEFINED;
}
static JSValue js_orb(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  return JS_NewBool(ctx, orb_use((int)A(0), (int)A(1), A(2), A(3)));
}
static JSValue js_drop(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int k = (int)A(0);
  if (k >= 0 && k < PK_N) pickup_drop(k, A(1), A(2), A(3));
  return JS_UNDEFINED;
}
static JSValue js_slots(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  const char *s = argc > 1 ? JS_ToCString(ctx, argv[1]) : NULL;
  const bool ok = s && i >= 0 && i < S.np && player_set_slots(&S.pl[i], s, (int)A(2));
  if (s) JS_FreeCString(ctx, s);
  return JS_NewBool(ctx, ok);
}
/* core_free(x, y, r) -> el mundo del núcleo: ¿cabe ahí? (diagnóstico de «paredes invisibles»: shim/core.js lo compara con el JS) */
static JSValue js_core_free(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  return JS_NewBool(ctx, world_is_free(A(0), A(1), A(2), true));
}
static JSValue js_ppos(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  if (i >= 0 && i < S.np) { Player *p = &S.pl[i]; p->x = p->px = A(1); p->y = p->py = A(2); p->svx = p->svy = p->vx = p->vy = 0; }
  return JS_UNDEFINED;
}
static JSValue js_php(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = (int)A(0);
  if (i < 0 || i >= S.np) return JS_UNDEFINED;
  Player *p = &S.pl[i];
  p->hp = fmin(p->maxHp, fmax(0, A(1)));
  const bool dead = A(2) != 0;
  if (p->dead && !dead) { p->dead = false; p->reviveT = 0; p->invuln = fmax(p->invuln, 1); if (p->hp <= 0) p->hp = 1; }
  else if (!p->dead && (dead || p->hp <= 0)) { p->hp = 0; p->dead = true; p->reviveT = 0; }
  return JS_UNDEFINED;
}
static JSValue js_god(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) { sim_god = A(0) != 0; return JS_UNDEFINED; }
static JSValue js_eset(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  Enemy *e = sim_enemy((int)A(0));
  if (e) { e->x = A(1); e->y = A(2); e->hp = fmin(e->maxHp, A(3)); e->xp = A(4); e->golden = A(5) != 0; }
  return JS_UNDEFINED;
}
static JSValue js_stash(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) { sim_stash(); return JS_UNDEFINED; }
static JSValue js_restore(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) { sim_restore(); return JS_UNDEFINED; }
static JSValue js_clear(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) { sim_clear((int)A(0)); return JS_UNDEFINED; }
static JSValue js_pullall(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  for (int i = 0; i < S.npu; i++) S.pu[i].pulled = true;
  return JS_UNDEFINED;
}
static JSValue js_arena(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  world_set_arena(A(0), A(1), A(2), (int)A(3));
  return JS_UNDEFINED;
}
static JSValue js_mode(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  S.inArena = A(0) != 0; S.judge = A(1) != 0; S.arcK = A(2); S.arcShield = A(3) != 0;
  return JS_UNDEFINED;
}
static JSValue js_biome(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  world_set_biome((int)A(0));
  return JS_UNDEFINED;
}
static JSValue js_hazard(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int f = (int)A(12);
  return JS_NewInt32(ctx, hazard_add(&(Hazard){ .kind = (int)A(0), .x = A(1), .y = A(2), .r = A(3), .angle = A(4), .len = A(5), .w = A(6),
                                                .delay = A(7), .dmg = A(8), .type = (int)A(9), .cat = (int)A(10), .pct = A(11),
                                                .pure = f & 1, .boom = f & 2, .vis = f >> 2 & 1 }));
}
static JSValue js_weather(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int k = (int)A(0);
  S.wx = k > 0 && k <= WX_FOG ? k : WX_NONE; S.wxLv = S.wx ? u_clamp(A(1), 0, 1) : 0;
  return JS_UNDEFINED;
}
static JSValue js_events(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  double *b = malloc(((size_t)S.nev * 8 + 1) * sizeof *b), *o = b;
  if (!b) return JS_NULL;
  for (int i = 0; i < S.nev; i++) { const Ev *e = &S.ev[i]; *o++ = e->k; *o++ = e->who; *o++ = e->id; *o++ = e->x; *o++ = e->y; *o++ = e->a; *o++ = e->b; *o++ = e->c; }
  JSValue r = JS_NewArrayBufferCopy(ctx, (const uint8_t *)b, (size_t)S.nev * 8 * sizeof *b);
  free(b);
  S.nev = 0;   /* (leídos: sim_step no los borra) */
  return r;
}
static JSValue js_step(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const double dt = A(0);
  if (dt > 0 && dt < 0.25) sim_step(dt);
  return JS_UNDEFINED;
}

static JSValue js_state(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const size_t n = sim_pack_len();
  double *b = malloc(n * sizeof *b);
  if (!b) return JS_NULL;
  sim_pack(b);
  JSValue r = JS_NewArrayBufferCopy(ctx, (const uint8_t *)b, n * sizeof *b);
  free(b);
  return r;
}

/* core_props(x, y, r) -> [tx, ty, hp, open, charge, used] de cada objeto (rompible o especial) en ese círculo: el mundo
 * que se pinta (G.World) copia su vida, el candado, el manantial y el altar usado. */
static JSValue js_props(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  Prop *in[512];
  int n = world_props_in_circle(A(0), A(1), A(2), in, 256);
  n += world_specials_near(A(0), A(1), A(2), in + n, 256);
  double b[512 * 6];
  for (int i = 0; i < n; i++) {
    const Prop *p = in[i];
    double *o = b + i * 6;
    o[0] = p->tx; o[1] = p->ty; o[2] = isfinite(p->hp) ? p->hp : -1; o[3] = p->open; o[4] = p->charge; o[5] = p->used;
  }
  return JS_NewArrayBufferCopy(ctx, (const uint8_t *)b, n * 6 * sizeof *b);
}

void core_register(JSContext *ctx, JSValue ps) {
  static const struct { const char *name; JSCFunction *fn; int n; } F[] = {
    { "core_reset", js_reset, 4 }, { "core_player", js_player, 6 }, { "core_input", js_input, 5 }, { "core_view", js_view, 2 },
    { "core_enemy", js_enemy, 19 }, { "core_step", js_step, 1 }, { "core_state", js_state, 0 }, { "core_stats", js_stats, 6 },
    { "core_learn", js_learn, 4 }, { "core_active", js_active, 2 }, { "core_events", js_events, 0 }, { "core_movelvl", js_movelvl, 4 },
    { "core_ability", js_ability, 3 }, { "core_item", js_item, 2 }, { "core_orb", js_orb, 4 }, { "core_weather", js_weather, 2 }, { "core_drop", js_drop, 4 }, { "core_biome", js_biome, 1 }, { "core_hazard", js_hazard, 13 },
    { "core_ppos", js_ppos, 3 }, { "core_php", js_php, 3 }, { "core_god", js_god, 1 }, { "core_eset", js_eset, 6 }, { "core_stash", js_stash, 0 },
    { "core_restore", js_restore, 0 }, { "core_clear", js_clear, 1 }, { "core_pullall", js_pullall, 0 }, { "core_arena", js_arena, 4 },
    { "core_mode", js_mode, 4 }, { "core_slots", js_slots, 3 }, { "core_props", js_props, 3 }, { "core_dealt", js_dealt, 1 },
    { "core_free", js_core_free, 3 },
  };
  for (size_t i = 0; i < sizeof F / sizeof *F; i++) JS_SetPropertyStr(ctx, ps, F[i].name, JS_NewCFunction(ctx, F[i].fn, F[i].name, F[i].n));
  JS_SetPropertyStr(ctx, ps, "CORE_PL", JS_NewInt32(ctx, SIM_PL));
  JS_SetPropertyStr(ctx, ps, "CORE_EN", JS_NewInt32(ctx, SIM_EN));
  JS_SetPropertyStr(ctx, ps, "CORE_PR", JS_NewInt32(ctx, SIM_PR));
  JS_SetPropertyStr(ctx, ps, "CORE_FI", JS_NewInt32(ctx, SIM_FI));
  JS_SetPropertyStr(ctx, ps, "CORE_PU", JS_NewInt32(ctx, SIM_PU));
  JS_SetPropertyStr(ctx, ps, "CORE_HZ", JS_NewInt32(ctx, SIM_HZ));
}
