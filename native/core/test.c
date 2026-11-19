/* test.c — core-test: responde por stdin a las mismas preguntas que bench-world.cjs le hace al JS, una por línea.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include "core.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

static void prop(const Prop *p) { printf(" %d,%d,%d,%d", p->type, p->tx, p->ty, p->kind); }

int main(void) {
  setvbuf(stdout, NULL, _IOLBF, 0);   /* (run-node.cjs habla con él por FIFO, línea a línea) */
  char cmd[32];
  double a, b, c, d;
  while (scanf("%31s", cmd) == 1) {
    if (!strcmp(cmd, "reset") && scanf("%lf", &a) == 1) world_reset((int32_t)a);
    else if (!strcmp(cmd, "hw") && scanf("%lf %lf", &a, &b) == 2) world_halloween(a, b);
    else if (!strcmp(cmd, "biome") && scanf("%lf", &a) == 1) world_set_biome((int)a);
    else if (!strcmp(cmd, "arena") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) world_set_arena(a, b, c, (int)d);
    else if (!strcmp(cmd, "terr") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) {
      for (int y = (int)b; y < b + d; y++) for (int x = (int)a; x < a + c; x++) putchar('0' + world_terrain(x, y));
      putchar('\n');
    } else if (!strcmp(cmd, "walk") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) {
      for (int y = (int)b; y < b + d; y++) for (int x = (int)a; x < a + c; x++) putchar('0' + world_walkable(x, y));
      putchar('\n');
    } else if (!strcmp(cmd, "props") && scanf("%lf %lf", &a, &b) == 2) {   /* las del trozo (a, b), en su orden */
      int m; const Prop *ps = world_chunk_props((int32_t)a, (int32_t)b, &m);
      printf("%d", m); for (int i = 0; i < m; i++) prop(&ps[i]); putchar('\n');
    } else if (!strcmp(cmd, "free") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) printf("%d\n", world_is_free(a, b, c, d));
    else if (!strcmp(cmd, "coll") && scanf("%lf %lf %lf", &a, &b, &c) == 3) { const int h = world_collide(&a, &b, c); printf("%d %.17g %.17g\n", h, a, b); }
    else if (!strcmp(cmd, "pblk") && scanf("%lf %lf %lf", &a, &b, &c) == 3) {
      Prop *p = NULL; const int k = world_projectile_block(a, b, c, &p);
      printf("%d", k); if (p) prop(p); putchar('\n');
    } else if ((!strcmp(cmd, "circ") || !strcmp(cmd, "spec")) && scanf("%lf %lf %lf", &a, &b, &c) == 3) {
      Prop *in[4096];
      const int n = cmd[0] == 'c' ? world_props_in_circle(a, b, c, in, 4096) : world_specials_near(a, b, c, in, 4096);
      printf("%d", n); for (int i = 0; i < n; i++) prop(in[i]); putchar('\n');
    } else if (!strcmp(cmd, "near") && scanf("%lf %lf %lf", &a, &b, &c) == 3) {
      const Prop *p = world_nearest_breakable(a, b, c);
      printf("%d", !!p); if (p) prop(p); putchar('\n');
    } else if (!strcmp(cmd, "dmg") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) {   /* daña la rompible más cercana */
      Prop *p = world_nearest_breakable(a, b, c), gone;
      if (!p) { puts("-"); continue; }
      const int t = world_damage_prop(p, d, &gone);
      printf("%d", t); prop(t ? &gone : p); printf(" %.17g\n", t ? gone.hp : p->hp);
    } else if (!strcmp(cmd, "liq") && scanf("%lf", &a) == 1) {
      const LiqFx f = world_liquid_effect((uint32_t)a);
      printf("%d %.17g %.17g %.17g %.17g %d\n", world_liquid(), f.slow, f.dmg, f.flat, f.every, f.slide);
    }
    /* ---- la partida (bench-sim.cjs) ---- */
    else if (!strcmp(cmd, "sreset") && scanf("%lf %lf", &a, &b) == 2) { sim_reset((int32_t)a); world_set_biome((int)b); }
    else if (!strcmp(cmd, "padd")) {   /* x y r spd types */
      double r, s, t; if (scanf("%lf %lf %lf %lf %lf", &a, &b, &r, &s, &t) != 5) return 1;
      sim_add_player(0, (uint32_t)t, a, b, r, s);
    } else if (!strcmp(cmd, "ppos") && scanf("%lf %lf %lf", &a, &b, &c) == 3) { Player *p = &S.pl[(int)a]; p->x = b; p->y = c; p->svx = p->svy = 0; p->inLiquid = false; }
    else if (!strcmp(cmd, "pbuild") && scanf("%lf", &a) == 1) {
      path_build((int)a);
      int32_t ox, oy; const int16_t *f = path_field((int)a, &ox, &oy);
      long sum = 0; int seen = 0; for (int i = 0; i < PATH_N * PATH_N; i++) if (f[i] != 0x7fff) { sum += f[i] * (i % 97 + 1); seen++; }
      printf("%d %d %d %ld\n", ox, oy, seen, sum);   /* (el JS no enseña su campo: se compara con pdir) */
    } else if (!strcmp(cmd, "pdir") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) {   /* jugador x y r */
      Enemy e = { .x = b, .y = c, .r = d };
      double dx, dy;
      if (path_dir(&e, (int)a, &dx, &dy)) printf("%.17g %.17g\n", dx, dy); else puts("-");
    } else if (!strcmp(cmd, "pmove")) {   /* jugador ax ay dt pasos */
      double ax, ay, dt, n; if (scanf("%lf %lf %lf %lf %lf", &a, &ax, &ay, &dt, &n) != 5) return 1;
      Player *p = &S.pl[(int)a];
      p->in.ax = ax; p->in.ay = ay;
      for (int i = 0; i < n; i++) player_update(p, dt);
      printf("%.17g %.17g %.17g %.17g %d\n", p->x, p->y, p->svx, p->svy, p->inLiquid);
    } else if (!strcmp(cmd, "eadd")) {   /* beh x y r spd flying range shotCd types */
      double v[9]; for (int i = 0; i < 9; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      Enemy t = { .beh = (int)v[0], .x = v[1], .y = v[2], .r = v[3], .spd = v[4], .flying = v[5], .range = v[6], .shotCd0 = v[7],
                  .types = (uint32_t)v[8], .maxHp = 20, .atkType = -1 };
      sim_add_enemy(&t);
      S.en[S.ne - 1].shotCd = v[7];   /* (sin el azar del principio: el banco lo fija) */
    } else if (!strcmp(cmd, "estate")) {   /* i phase pt vx vy (para el corredor: velocidad del jugador 0) */
      double v[5]; for (int i = 0; i < 5; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      Enemy *e = &S.en[(int)v[0]]; e->phase = (int)v[1]; e->pt = v[2];
      S.pl[0].vx = v[3]; S.pl[0].vy = v[4]; S.pl[0].moved = true;
    } else if (!strcmp(cmd, "estep") && scanf("%lf %lf %lf", &a, &b, &c) == 3) {   /* i dt pasos (hacia el jugador 0) */
      Enemy *e = &S.en[(int)a];
      for (int i = 0; i < c; i++) enemy_update(e, 0, b);
      printf("%.17g %.17g %d %.17g %.17g %.17g %.17g\n", e->x, e->y, e->phase, e->pt, e->sideT, e->stuckT, e->zig);
    } else if (!strcmp(cmd, "sep") && scanf("%lf", &a) == 1) {
      enemy_grid(); enemy_separate(a);
      for (int i = 0; i < S.ne; i++) printf("%s%.17g %.17g", i ? " " : "", S.en[i].x, S.en[i].y);
      putchar('\n');
    } else if (!strcmp(cmd, "query") && scanf("%lf %lf %lf", &a, &b, &c) == 3) {
      enemy_grid();
      int out[MAXEN]; const int n = sim_query_circle(a, b, c, out, MAXEN);
      printf("%d", n); for (int i = 0; i < n; i++) printf(" %d", out[i]); putchar('\n');
    }
    /* ---- lo mismo que ps.core_* (core_js.c), para el arnés de Node (PS_CORE=1 en run-node.cjs) ---- */
    else if (!strcmp(cmd, "creset") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) { sim_reset((int32_t)a); world_set_biome((int)b); world_halloween(c, d); puts("ok"); }
    else if (!strcmp(cmd, "cplayer")) {
      double v[6]; for (int i = 0; i < 6; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      printf("%d\n", sim_add_player((int)v[0], (uint32_t)v[1], v[2], v[3], v[4], v[5]));
    } else if (!strcmp(cmd, "cinput")) {
      double v[5]; for (int i = 0; i < 5; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      if (v[0] >= 0 && v[0] < S.np) S.pl[(int)v[0]].in = (CoreInput){ v[1], v[2], v[3], v[4], 0 };
      puts("ok");
    } else if (!strcmp(cmd, "cview") && scanf("%lf %lf", &a, &b) == 2) { if (a >= 0 && a < S.np) S.pl[(int)a].view = b; puts("ok"); }
    else if (!strcmp(cmd, "cenemy")) {
      double v[19]; for (int i = 0; i < 19; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      Enemy t = { .arceus = (int)v[16] & 64, .boss = (int)v[16] & 1, .legend = (int)v[16] & 2, .judge = (int)v[16] & 4, .shiny = (int)v[16] & 8, .golden = (int)v[16] & 16, .loot10 = (int)v[16] & 32, .zones = (int)v[17], .beh = (int)v[0], .dex = (int)v[1], .x = v[2], .y = v[3], .r = v[4], .spd = v[5], .maxHp = v[6], .flying = v[7],
                  .range = v[8], .shotCd0 = v[9], .types = (uint32_t)v[10], .life = 30, .dmg = v[11], .atkType = (int)v[12],
                  .shotDmg = v[13], .fanN = v[14], .xp = v[15] };
      if (v[18] > 0) t.life = v[18];
      printf("%d\n", sim_add_enemy(&t));
    } else if (!strcmp(cmd, "cppos") && scanf("%lf %lf %lf", &a, &b, &c) == 3) {
      if (a >= 0 && a < S.np) { Player *p = &S.pl[(int)a]; p->x = p->px = b; p->y = p->py = c; p->svx = p->svy = p->vx = p->vy = 0; }
      puts("ok");
    } else if (!strcmp(cmd, "cgod") && scanf("%lf", &a) == 1) {
      sim_god = a != 0; puts("ok");
    } else if (!strcmp(cmd, "cphp") && scanf("%lf %lf %lf", &a, &b, &c) == 3) {
      if (a >= 0 && a < S.np) {
        Player *p = &S.pl[(int)a];
        p->hp = fmin(p->maxHp, fmax(0, b));
        if (p->dead && !c) { p->dead = false; p->reviveT = 0; p->invuln = fmax(p->invuln, 1); if (p->hp <= 0) p->hp = 1; }
        else if (!p->dead && (c || p->hp <= 0)) { p->hp = 0; p->dead = true; p->reviveT = 0; }
      }
      puts("ok");
    } else if (!strcmp(cmd, "ceset")) {
      double v[6]; for (int i = 0; i < 6; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      Enemy *e = sim_enemy((int)v[0]);
      if (e) { e->x = v[1]; e->y = v[2]; e->hp = fmin(e->maxHp, v[3]); e->xp = v[4]; e->golden = v[5] != 0; }
      puts("ok");
    } else if (!strcmp(cmd, "cslots")) {
      char lay[512]; if (scanf("%lf %511s %lf", &a, lay, &b) != 3) return 1;
      printf("%d\n", a >= 0 && a < S.np && player_set_slots(&S.pl[(int)a], lay, (int)b));
    } else if (!strcmp(cmd, "cstash")) { sim_stash(); puts("ok"); }
    else if (!strcmp(cmd, "crestore")) { sim_restore(); puts("ok"); }
    else if (!strcmp(cmd, "cclear") && scanf("%lf", &a) == 1) { sim_clear((int)a); puts("ok"); }
    else if (!strcmp(cmd, "cpullall")) { for (int i = 0; i < S.npu; i++) S.pu[i].pulled = true; puts("ok"); }
    else if (!strcmp(cmd, "cprops") && scanf("%lf %lf %lf", &a, &b, &c) == 3) {   /* = core_props de core_js.c */
      Prop *in[512]; int n = world_props_in_circle(a, b, c, in, 256); n += world_specials_near(a, b, c, in + n, 256);
      for (int i = 0; i < n; i++) printf("%s%d %d %.17g %.17g %.17g %d", i ? " " : "", in[i]->tx, in[i]->ty, isfinite(in[i]->hp) ? in[i]->hp : -1, in[i]->open, in[i]->charge, in[i]->used);
      putchar('\n');
    }
    else if (!strcmp(cmd, "carena") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) { world_set_arena(a, b, c, (int)d); puts("ok"); }
    else if (!strcmp(cmd, "cmode") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) { S.inArena = a; S.judge = b; S.arcK = c; S.arcShield = d; puts("ok"); }
    else if (!strcmp(cmd, "cbiome") && scanf("%lf", &a) == 1) { world_set_biome((int)a); puts("ok"); }
    else if (!strcmp(cmd, "chazard")) {   /* tipo x y r ángulo largo ancho aviso daño tipo-del-golpe categoría pct (puro | boom<<1 | pilar<<2) */
      double v[13]; for (int i = 0; i < 13; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      printf("%d\n", hazard_add(&(Hazard){ .kind = (int)v[0], .x = v[1], .y = v[2], .r = v[3], .angle = v[4], .len = v[5], .w = v[6],
                                            .delay = v[7], .dmg = v[8], .type = (int)v[9], .cat = (int)v[10], .pct = v[11],
                                            .pure = (int)v[12] & 1, .boom = (int)v[12] & 2, .vis = (int)v[12] >> 2 & 1 }));
    } else if (!strcmp(cmd, "cstep") && scanf("%lf", &a) == 1) { if (a > 0 && a < 0.25) sim_step(a); puts("ok"); }
    else if (!strcmp(cmd, "cstats")) {
      double v[11]; for (int i = 0; i < 11; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      if (v[0] >= 0 && v[0] < S.np) {
        Player *p = &S.pl[(int)v[0]];
        if (v[1] > 0) { p->hp = p->hp / p->maxHp * v[1]; p->maxHp = v[1]; }
        p->atkMul = v[2] > 0 ? v[2] : 1; p->cdMul = v[3] > 0 ? v[3] : 1; p->dmgReduce = v[4]; p->critChance = v[5];
        p->spdMul = v[6] > 0 ? v[6] : 1; p->regenFlat = v[7]; p->magnet = v[8] > 0 ? v[8] : 78; p->xpMul = v[9] > 0 ? v[9] : 1;
        if (v[10] > 0) p->hp = v[10] < p->maxHp ? v[10] : p->maxHp;
        if (p->power >= 0) power_apply(p, 1);
      }
      puts("ok");
    } else if (!strcmp(cmd, "clearn")) {   /* jugador id nivel evolucionado */
      char id[64]; double pi, lv, ev;
      if (scanf("%lf %63s %lf %lf", &pi, id, &lv, &ev) != 4) return 1;
      bool ok = false;
      if (pi >= 0 && pi < S.np && (ok = player_learn(&S.pl[(int)pi], move_find(id), (int)lv))) S.pl[(int)pi].mv[S.pl[(int)pi].nmv - 1].evo = ev != 0;
      printf("%d\n", ok);
    } else if (!strcmp(cmd, "cmovelvl")) {
      char id[64]; double pi, lv, ev;
      if (scanf("%lf %63s %lf %lf", &pi, id, &lv, &ev) != 4) return 1;
      const int d = move_find(id); int ok = 0;
      if (pi >= 0 && pi < S.np) for (int k = 0; k < S.pl[(int)pi].nmv; k++) if (S.pl[(int)pi].mv[k].def == d) {
        PMove *m = &S.pl[(int)pi].mv[k]; m->lvl = lv < 1 ? 1 : lv > core_moves[d].maxLvl ? core_moves[d].maxLvl : (int)lv; m->evo = ev != 0 && core_moves[d].evolves; ok = 1;
      }
      printf("%d\n", ok);
    } else if (!strcmp(cmd, "cactive") && scanf("%lf %lf", &a, &b) == 2) { if (a >= 0 && a < S.np) player_set_active(&S.pl[(int)a], (int)b); puts("ok"); }
    else if (!strcmp(cmd, "cability")) {   /* jugador habilidad tipo0 */
      char id[40]; if (scanf("%lf %39s %lf", &a, id, &b) != 3) return 1;
      if (a >= 0 && a < S.np) player_set_ability(&S.pl[(int)a], abil_find(id), (int)b);
      puts("ok");
    } else if (!strcmp(cmd, "citem") && scanf("%lf %lf", &a, &b) == 2) { if (a >= 0 && a < S.np) S.pl[(int)a].item = b >= 0 && b < IT_N ? (int)b : -1; puts("ok"); }
    else if (!strcmp(cmd, "corb") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) printf("%d\n", orb_use((int)a, (int)b, c, d));
    else if (!strcmp(cmd, "cdrop") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) { if (a >= 0 && a < PK_N) pickup_drop((int)a, b, c, d); puts("ok"); }
    else if (!strcmp(cmd, "cweather") && scanf("%lf %lf", &a, &b) == 2) { S.wx = a > 0 && a <= WX_FOG ? (int)a : 0; S.wxLv = S.wx ? u_clamp(b, 0, 1) : 0; puts("ok"); }
    else if (!strcmp(cmd, "cevents")) {
      for (int i = 0; i < S.nev; i++) { const Ev *e = &S.ev[i]; printf("%s%d %d %d %.17g %.17g %.17g %.17g %.17g", i ? " " : "", e->k, e->who, e->id, e->x, e->y, e->a, e->b, e->c); }
      putchar('\n');
      S.nev = 0;   /* (leídos, como core_events) */
    }
    else if (!strcmp(cmd, "cstate")) {
      static double buf[9 + MAXPL * SIM_PL + MAXEN * SIM_EN + MAXPR * SIM_PR + MAXFI * SIM_FI + (MAXPU + 1) * SIM_PU + MAXHZ * SIM_HZ];
      sim_pack(buf);
      const size_t n = sim_pack_len();
      for (size_t i = 0; i < n; i++) printf(i ? " %.17g" : "%.17g", buf[i]);
      putchar('\n');
    }
    /* ---- combate (bench-combat.cjs): enemigos quietos, sólo ataques y daño ---- */
    else if (!strcmp(cmd, "kreset") && scanf("%lf %lf", &a, &b) == 2) { sim_reset((int32_t)a); world_set_biome((int)b); S.rng.fix = 0.5; }
    else if (!strcmp(cmd, "kplayer")) {   /* dex x y r spd */
      double v[5]; for (int i = 0; i < 5; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      const int k = sim_add_player((int)v[0], dex_of((int)v[0]) ? dex_of((int)v[0])->types : 1, v[1], v[2], v[3], v[4]);
      S.pl[k].view = 1e9;
    } else if (!strcmp(cmd, "klearn")) {   /* jugador id nivel evolucionado */
      char id[64]; double pi, lv, ev;
      if (scanf("%lf %63s %lf %lf", &pi, id, &lv, &ev) != 4) return 1;
      Player *p = &S.pl[(int)pi];
      if (player_learn(p, move_find(id), (int)lv)) p->mv[p->nmv - 1].evo = ev != 0;
      else fprintf(stderr, "core-test: no aprende %s\n", id);
    } else if (!strcmp(cmd, "kenemy")) {   /* dex x y r hp dmg atkType types */
      double v[8]; for (int i = 0; i < 8; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      Enemy t = { .dex = (int)v[0], .x = v[1], .y = v[2], .r = v[3], .maxHp = v[4], .dmg = v[5], .atkType = (int)v[6], .types = (uint32_t)v[7],
                  .range = 200, .spd = 60 };
      sim_add_enemy(&t);
    } else if (!strcmp(cmd, "kstep") && scanf("%lf %lf", &a, &b) == 2) {   /* dt pasos */
      for (int n = 0; n < b; n++) {
        S.time += a;
        for (int i = 0; i < S.np; i++) player_update(&S.pl[i], a);
        enemy_grid();
        for (int i = 0; i < S.np; i++) combat_tick(&S.pl[i], a);
        proj_update(a);
        combat_resolve(a);
        combat_fields(a);
      }
      const Player *p = &S.pl[0];
      printf("%.17g %.17g %.17g %.17g %d %d", p->hp, p->dmgDealt, p->x, p->y, S.npr, S.nfi);
      for (int i = 0; i < S.ne; i++) printf(" %.17g %d %.17g %.17g", S.en[i].hp, S.en[i].dead, S.en[i].x, S.en[i].y);
      putchar('\n');
    }
    /* ---- recogidas (bench-pickup.cjs) ---- */
    else if (!strcmp(cmd, "uxpfor") && scanf("%lf", &a) == 1) printf("%.17g\n", xp_for((int)a));
    else if (!strcmp(cmd, "ureset") && scanf("%lf", &a) == 1) { sim_reset((int32_t)a); S.rng.fix = 0.5; }
    else if (!strcmp(cmd, "uplayer") && scanf("%lf %lf %lf", &a, &b, &c) == 3) { const int k = sim_add_player(25, 1, a, b, 16, 100); S.pl[k].magnet = c; S.pl[k].view = 1e9; }
    else if (!strcmp(cmd, "upos") && scanf("%lf %lf %lf", &a, &b, &c) == 3) { S.pl[(int)a].x = b; S.pl[(int)a].y = c; }
    else if (!strcmp(cmd, "udrop") && scanf("%lf %lf %lf %lf", &a, &b, &c, &d) == 4) pickup_drop((int)a, b, c, d);
    else if (!strcmp(cmd, "udropxp")) {
      double v[5]; for (int i = 0; i < 5; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      pickup_drop_xp(v[0], v[1], v[2], v[3] != 0, v[4] != 0, false);
    } else if (!strcmp(cmd, "ustep") && scanf("%lf", &a) == 1) {
      S.nev = 0;
      pickup_update(a);
      int n = 0;
      for (int i = 0; i < S.nev; i++) if (S.ev[i].k == EV_PICK) printf("%s%d:%d:%.17g", n++ ? " " : "", S.ev[i].who, S.ev[i].id, S.ev[i].id == PK_SPHERE || S.ev[i].id == PK_ITEM ? 0 : S.ev[i].a);
      printf(" |");
      for (int i = 0; i < S.npu; i++) printf(" %d %.17g %.17g %.17g", S.pu[i].kind, S.pu[i].x, S.pu[i].y, S.pu[i].kind == PK_SPHERE || S.pu[i].kind == PK_ITEM ? 0 : S.pu[i].value);   /* (cuál, al azar: no se compara) */
      putchar('\n');
    }
    /* ---- habilidades (bench-abil.cjs): el jugador 0, sus ganchos uno a uno ---- */
    else if (!strcmp(cmd, "aplayer")) {   /* dex tipo0 habilidad (- : ninguna conocida) */
      char id[40]; if (scanf("%lf %lf %39s", &a, &b, id) != 3) return 1;
      sim_reset(1); S.rng.fix = 0.5;
      const DexStat *m = dex_of((int)a);
      sim_add_player((int)a, m ? m->types : 1, 0, 0, 16, 100);
      player_set_ability(&S.pl[0], abil_find(id), (int)b);
    } else if (!strcmp(cmd, "aset")) {   /* hp maxHp slowT clima intensidad objeto moxie ssT escudo enfadado humor nivel */
      double v[12]; for (int i = 0; i < 12; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      Player *p = &S.pl[0];
      p->hp = v[0]; p->maxHp = v[1]; p->slowT = v[2]; S.wx = (int)v[3]; S.wxLv = v[4]; p->item = (int)v[5]; p->moxie = v[6];
      p->ssT = v[7]; p->shieldForm = v[8] != 0; p->angry = v[9] != 0; p->mood = (int)v[10]; p->level = (int)v[11];
    } else if (!strcmp(cmd, "aout")) {   /* ataque nivel tipos-enemigo jefe vida vidamáx (tipos 0: sin enemigo) */
      char id[40]; double v[5]; if (scanf("%39s", id) != 1) return 1;
      for (int i = 0; i < 5; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      const PMove m = { .def = move_find(id), .lvl = (int)v[0] };
      const Enemy e = { .types = (uint32_t)v[1], .boss = v[2] != 0, .hp = v[3], .maxHp = v[4] };
      printf("%.17g\n", abil_out(&S.pl[0], &m, v[1] ? &e : NULL));
    } else if (!strcmp(cmd, "aq") && scanf("%lf %lf", &a, &b) == 2) {   /* tipo categoría ('p', 's' o 0) */
      const Player *p = &S.pl[0];
      printf("%.17g %.17g %d %.17g %.17g %.17g %.17g %d\n", abil_in(p, (int)a, (int)b), abil_has_dodge(p) ? abil_dodge(p, (int)a, (int)b) : -1,
             abil_absorb(p), abil_speed(p), abil_heal_mul(p), abil_status_cd(p), abil_crit_mul(p), abil_flags(p));
    } else if (!strcmp(cmd, "atick") && scanf("%lf %lf", &a, &b) == 2) {   /* dt pasos */
      Player *p = &S.pl[0];
      for (int i = 0; i < b; i++) abil_tick(p, a);
      printf("%.17g %.17g %.17g %.17g %d %d %d %d\n", p->hp, p->slowT, p->abSpd, p->ssT, p->shieldForm, p->angry, p->boomed, p->mood);
    } else if (!strcmp(cmd, "ahurt") && scanf("%lf %lf", &a, &b) == 2) {   /* tipo categoría */
      Player *p = &S.pl[0];
      abil_hurt(p, (int)a, (int)b);
      printf("%g %.17g %.17g %g %.17g %.17g %d\n", p->bn[BF_SPD], p->bamt[BF_SPD], p->bt[BF_SPD], p->bn[BF_DEF], p->bamt[BF_DEF], p->bt[BF_DEF], S.npu);
    } else if (!strcmp(cmd, "acontact") && scanf("%lf %lf", &a, &b) == 2) {   /* tipos-enemigo vida */
      S.ne = 0;
      const Enemy t = { .beh = BEH_CHASE, .dex = 25, .x = 20, .y = 0, .r = 12, .spd = 60, .maxHp = b, .types = (uint32_t)a, .dmg = 5, .xp = 3, .life = 30 };
      sim_add_enemy(&t);
      Enemy *e = &S.en[0];
      abil_contact(&S.pl[0], e);
      abil_hit(&S.pl[0], e, NULL);
      printf("%.17g %.17g %.17g %.17g %.17g %.17g\n", e->hp, e->slow, e->slowT, e->burn, e->poison, e->sleepT);
    }
    /* ---- enemigos especiales y jefes (bench-foe.cjs): el jugador 0 quieto donde se diga ---- */
    else if (!strcmp(cmd, "freset") && scanf("%lf %lf", &a, &b) == 2) {
      sim_reset((int32_t)a); world_set_biome((int)b); S.rng.fix = 0.5;
      sim_add_player(25, 1u << TY_ELECTRIC, 0, 0, 14, 100); S.pl[0].view = 1e9; S.pl[0].hp = S.pl[0].maxHp = 1e6;
    } else if (!strcmp(cmd, "frd") && scanf("%lf %lf", &a, &b) == 2) S.en[(int)a].rd = b;
    else if (!strcmp(cmd, "fhp") && scanf("%lf %lf", &a, &b) == 2) S.en[(int)a].hp = b;
    else if (!strcmp(cmd, "fplayer") && scanf("%lf %lf %lf", &a, &b, &c) == 3) { S.pl[0].x = a; S.pl[0].y = b; S.pl[0].r = c; }
    else if (!strcmp(cmd, "fenemy")) {   /* beh dex x y r spd hp dmg atkType types flying boss range shotCd shotDmg zones fanN */
      double v[17]; for (int i = 0; i < 17; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      const Enemy t = { .beh = (int)v[0], .dex = (int)v[1], .x = v[2], .y = v[3], .r = v[4], .spd = v[5], .maxHp = v[6], .dmg = v[7],
                        .atkType = (int)v[8], .types = (uint32_t)v[9], .flying = v[10] != 0, .boss = v[11] != 0, .range = v[12],
                        .shotCd0 = v[13], .shotDmg = v[14], .zones = (int)v[15], .fanN = v[16], .life = 30, .xp = 3 };
      sim_add_enemy(&t);
    } else if (!strcmp(cmd, "fstep") && scanf("%lf", &a) == 1) {
      S.nev = 0;
      enemy_grid();
      for (int i = 0; i < S.ne; i++) enemy_update(&S.en[i], 0, a);
      hazards_update(a);
      printf("%.17g %d %d", S.pl[0].hp, S.npr, S.nhz);
      for (int i = 0; i < S.ne; i++) { const Enemy *e = &S.en[i]; printf(" %.17g %.17g %.17g %d %.17g %d %d", e->x, e->y, e->hp, e->dead, e->shield, e->phase, e->jumping); }
      for (int i = 0; i < S.nhz; i++) { const Hazard *h = &S.hz[i]; printf(" %d %.17g %.17g %.17g %.17g %.17g %.17g %.17g %.17g", h->kind, h->x, h->y, h->r, h->angle, h->len, h->w, h->delay, h->dmg); }
      putchar('\n');
    }
    /* ---- el mapa (bench-map.cjs): altares, manantiales, cofre, trampas, clima que daña, caramelos ---- */
    else if (!strcmp(cmd, "mreset") && scanf("%lf %lf %lf", &a, &b, &c) == 3) {
      sim_reset((int32_t)a); world_set_biome((int)b); world_halloween(c, c); S.rng.fix = 0.5;
    } else if (!strcmp(cmd, "mplayer")) {   /* dex tipos x y r vidamáx vida nivel */
      double v[8]; for (int i = 0; i < 8; i++) if (scanf("%lf", &v[i]) != 1) return 1;
      const int k = sim_add_player((int)v[0], (uint32_t)v[1], v[2], v[3], v[4], 100);
      S.pl[k].maxHp = v[5]; S.pl[k].hp = v[6]; S.pl[k].level = S.level = (int)v[7]; S.pl[k].view = 1e9;
    } else if (!strcmp(cmd, "mpos") && scanf("%lf %lf", &a, &b) == 2) { S.pl[0].x = a; S.pl[0].y = b; }
    else if (!strcmp(cmd, "mwx") && scanf("%lf %lf", &a, &b) == 2) { S.wx = (int)a; S.wxLv = b; }
    else if (!strcmp(cmd, "mtime") && scanf("%lf", &a) == 1) S.time = a;
    else if (!strcmp(cmd, "mcandy") && scanf("%lf", &a) == 1) printf("%d\n", candy_take(a));
    else if (!strcmp(cmd, "mstep") && scanf("%lf %lf", &a, &b) == 2) {   /* dt, ¿también el clima? */
      S.nev = 0;
      enemy_grid();
      interact_update(a);
      if (b) weather_chip(a);
      const Player *p = &S.pl[0];
      printf("%.17g %.17g %.17g %.17g %.17g %.17g %d %d", p->hp, p->slowT, p->atkMul, p->spdMul, p->magnet, p->cdMul, p->power, S.npu);   /* (lo curado sin enseñar no: en el JS es del módulo) */
      for (int i = 0; i < S.ne; i++) printf(" %.17g %.17g %.17g %d", S.en[i].hp, S.en[i].slow, S.en[i].poison, S.en[i].dead);
      Prop *sp[256]; const int n = world_specials_near(p->x, p->y, 720, sp, 256);
      for (int i = 0; i < n; i++) printf(" %d %.17g %.17g %d", sp[i]->type, sp[i]->charge, sp[i]->open, sp[i]->used);
      putchar('\n');
    }
    else { fprintf(stderr, "core-test: no entiendo «%s»\n", cmd); return 1; }
  }
  return 0;
}
