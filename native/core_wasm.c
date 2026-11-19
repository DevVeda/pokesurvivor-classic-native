/* core_wasm.c — el núcleo de la partida (core/) para la web, en WebAssembly: lo mismo que core_js.c (ps.core_*), con
 * funciones C planas (números) en vez de QuickJS. shim/core-web.js hace de ps.core_* sobre estas.
 *   Textos (ataque, habilidad, huecos): el JS los escribe en cw_buf() (UTF-8, acabado en 0).
 *   Listas (estado, eventos, objetos del mapa): la función deja los doubles en cw_out() y devuelve cuántos.
 * Compilar: just core-wasm (emscripten en Docker) → shim/core.wasm.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <math.h>
#include <stdlib.h>
#include <emscripten/emscripten.h>
#include "core.h"

#define API EMSCRIPTEN_KEEPALIVE
static char buf[4096];
static double *out;
static size_t outn;
static double *grow(size_t n) {   /* cw_out() con sitio para n doubles */
  if (n > outn) { free(out); outn = n + 1024; out = malloc(outn * sizeof *out); if (!out) outn = 0; }
  return out;
}
static Player *pl(int i) { return i >= 0 && i < S.np ? &S.pl[i] : NULL; }

API char *cw_buf(void) { return buf; }
API double *cw_out(void) { return out; }
API int cw_const(int k) { const int v[] = { SIM_PL, SIM_EN, SIM_PR, SIM_FI, SIM_PU, SIM_HZ }; return k >= 0 && k < 6 ? v[k] : 0; }

API void core_reset(double seed, double biome, double hw, double hwRun) {
  sim_reset((int32_t)seed); world_set_biome((int)biome); world_halloween(hw != 0, hwRun != 0);
}
API int core_player(double dex, double types, double x, double y, double r, double spd) {
  return sim_add_player((int)dex, (uint32_t)types, x, y, r, spd);
}
API void core_input(int i, double ax, double ay, double rx, double ry) { Player *p = pl(i); if (p) p->in = (CoreInput){ ax, ay, rx, ry, 0 }; }
API void core_view(int i, double r) { Player *p = pl(i); if (p) p->view = r; }
API int core_enemy(double beh, double dex, double x, double y, double r, double spd, double maxHp, double flying, double range,
                   double shotCd, double types, double dmg, double atkType, double shotDmg, double fanN, double xp, double flags,
                   double zones, double life) {
  const int b = (int)beh, f = (int)flags;
  Enemy t = { .beh = b >= 0 && b < BEH_N ? b : BEH_CHASE, .dex = (int)dex, .x = x, .y = y, .r = r, .spd = spd, .maxHp = maxHp,
              .flying = flying != 0, .range = range, .shotCd0 = shotCd, .types = (uint32_t)types, .dmg = dmg, .atkType = (int)atkType,
              .shotDmg = shotDmg, .fanN = fanN, .xp = xp, .boss = f & 1, .legend = f & 2, .judge = f & 4, .shiny = f & 8,
              .golden = f & 16, .loot10 = f & 32, .arceus = f & 64, .zones = (int)zones, .life = life > 0 ? life : 30 };
  return sim_add_enemy(&t);
}
/* core_stats(i, vida máx., ×ataque, ×recarga, reducción, crítico, ×velocidad, regeneración, imán, ×experiencia, vida); n = argumentos */
API void core_stats(int i, double maxHp, double atk, double cd, double red, double crit, double spd, double regen, double magnet,
                    double xpm, double hp, int n) {
  Player *p = pl(i);
  if (!p) return;
  if (maxHp > 0) { p->hp = p->hp / p->maxHp * maxHp; p->maxHp = maxHp; }
  p->atkMul = atk > 0 ? atk : 1; p->cdMul = cd > 0 ? cd : 1; p->dmgReduce = red; p->critChance = crit;
  if (n > 6) { p->spdMul = spd > 0 ? spd : 1; p->regenFlat = regen; p->magnet = magnet > 0 ? magnet : 78; p->xpMul = xpm > 0 ? xpm : 1; }
  if (n > 10 && hp > 0) p->hp = fmin(p->maxHp, hp);
  if (p->power >= 0) power_apply(p, 1);
}
/* core_dealt(i): en cw_out() [ataque (índice de core_moves), daño] por ataque; los nombres, con cw_move_id */
API int core_dealt(int i) {
  const Player *p = pl(i);
  if (!p || !grow((size_t)p->nmv * 2)) return 0;
  for (int k = 0; k < p->nmv; k++) { out[k * 2] = p->mv[k].def; out[k * 2 + 1] = p->mv[k].dealt; }
  return p->nmv;
}
API const char *cw_move_id(int d) { return core_moves[d].id; }
API int core_movelvl(int i, double lvl, double evo) {   /* (el ataque, en cw_buf) */
  Player *p = pl(i);
  bool ok = false;
  if (!p) return 0;
  const int d = move_find(buf);
  for (int k = 0; k < p->nmv; k++) if (p->mv[k].def == d) {
    const int lv = (int)lvl;
    p->mv[k].lvl = lv < 1 ? 1 : lv > core_moves[d].maxLvl ? core_moves[d].maxLvl : lv;
    p->mv[k].evo = evo != 0 && core_moves[d].evolves;
    ok = true;
  }
  return ok;
}
API int core_learn(int i, double lvl, double evo) {   /* (el ataque, en cw_buf) */
  Player *p = pl(i);
  bool ok = p && player_learn(p, move_find(buf), (int)lvl);
  if (ok) p->mv[p->nmv - 1].evo = evo != 0;
  return ok;
}
API void core_active(int i, double slot) { Player *p = pl(i); if (p) player_set_active(p, (int)slot); }
API void core_ability(int i, double type) { Player *p = pl(i); if (p) player_set_ability(p, abil_find(buf), (int)type); }   /* (en cw_buf) */
API void core_item(int i, double it) { Player *p = pl(i); if (p) p->item = it >= 0 && it < IT_N ? (int)it : -1; }
API int core_orb(int i, double slot, double hx, double hy) { return orb_use(i, (int)slot, hx, hy); }
API void core_drop(double k, double x, double y, double v) { if (k >= 0 && k < PK_N) pickup_drop((int)k, x, y, v); }
API int core_slots(int i, double active) { Player *p = pl(i); return p && player_set_slots(p, buf, (int)active); }   /* (en cw_buf) */
API int core_free(double x, double y, double r) { return world_is_free(x, y, r, true); }
API void core_ppos(int i, double x, double y) {
  Player *p = pl(i);
  if (p) { p->x = p->px = x; p->y = p->py = y; p->svx = p->svy = p->vx = p->vy = 0; }
}
API void core_php(int i, double hp, double dead) {
  Player *p = pl(i);
  if (!p) return;
  p->hp = fmin(p->maxHp, fmax(0, hp));
  const bool d = dead != 0;
  if (p->dead && !d) { p->dead = false; p->reviveT = 0; p->invuln = fmax(p->invuln, 1); if (p->hp <= 0) p->hp = 1; }
  else if (!p->dead && (d || p->hp <= 0)) { p->hp = 0; p->dead = true; p->reviveT = 0; }
}
API void core_god(double on) { sim_god = on != 0; }
API void core_eset(double id, double x, double y, double hp, double xp, double golden) {
  Enemy *e = sim_enemy((int)id);
  if (e) { e->x = x; e->y = y; e->hp = fmin(e->maxHp, hp); e->xp = xp; e->golden = golden != 0; }
}
API void core_stash(void) { sim_stash(); }
API void core_restore(void) { sim_restore(); }
API void core_clear(double what) { sim_clear((int)what); }
API void core_pullall(void) { for (int i = 0; i < S.npu; i++) S.pu[i].pulled = true; }
API void core_arena(double tx, double ty, double r, double theme) { world_set_arena(tx, ty, r, (int)theme); }
API void core_mode(double arena, double judge, double arcK, double shield) { S.inArena = arena != 0; S.judge = judge != 0; S.arcK = arcK; S.arcShield = shield != 0; }
API void core_biome(double b) { world_set_biome((int)b); }
API int core_hazard(double kind, double x, double y, double r, double angle, double len, double w, double delay, double dmg,
                    double type, double cat, double pct, double flags) {
  const int f = (int)flags;
  return hazard_add(&(Hazard){ .kind = (int)kind, .x = x, .y = y, .r = r, .angle = angle, .len = len, .w = w, .delay = delay, .dmg = dmg,
                               .type = (int)type, .cat = (int)cat, .pct = pct, .pure = f & 1, .boom = f & 2, .vis = f >> 2 & 1 });
}
API void core_weather(double k, double lv) { const int w = (int)k; S.wx = w > 0 && w <= WX_FOG ? w : WX_NONE; S.wxLv = S.wx ? u_clamp(lv, 0, 1) : 0; }
API void core_step(double dt) { if (dt > 0 && dt < 0.25) sim_step(dt); }
/* Las listas, en cw_out(): devuelven cuántos doubles */
API int core_events(void) {
  if (!grow((size_t)S.nev * 8)) return 0;
  double *o = out;
  for (int i = 0; i < S.nev; i++) { const Ev *e = &S.ev[i]; *o++ = e->k; *o++ = e->who; *o++ = e->id; *o++ = e->x; *o++ = e->y; *o++ = e->a; *o++ = e->b; *o++ = e->c; }
  const int n = S.nev * 8;
  S.nev = 0;   /* (leídos: sim_step no los borra) */
  return n;
}
API int core_state(void) {
  const size_t n = sim_pack_len();
  if (!grow(n)) return 0;
  sim_pack(out);
  return (int)n;
}
API int core_props(double x, double y, double r) {
  Prop *in[512];
  int n = world_props_in_circle(x, y, r, in, 256);
  n += world_specials_near(x, y, r, in + n, 256);
  if (!grow((size_t)n * 6)) return 0;
  for (int i = 0; i < n; i++) {
    const Prop *p = in[i];
    double *o = out + i * 6;
    o[0] = p->tx; o[1] = p->ty; o[2] = isfinite(p->hp) ? p->hp : -1; o[3] = p->open; o[4] = p->charge; o[5] = p->used;
  }
  return n * 6;
}
