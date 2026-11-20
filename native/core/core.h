/* core.h — núcleo de la partida en C (ver native/CORE.md). C17, sin nada de la PS5: compila igual en el Mac.
 * Las cuentas se hacen en double y en el mismo orden que js/app.js, para que salga lo mismo (banco: core/bench-world.cjs).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#ifndef CORE_H
#define CORE_H
/* Sin a*b+c fundidos (FMA): igual que el JS, bit a bit. GCC no entiende el pragma: -ffp-contract=off en los Makefile. */
#ifdef __clang__
#pragma STDC FP_CONTRACT OFF
#endif
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* ---------------- azar ---------------- */
/* Hash 2D -> [0,1): G.U.hash (L43), el del terreno. */
static inline double core_hash(int32_t x, int32_t y, int32_t s) {
  uint32_t h = (uint32_t)x * 374761393u ^ (uint32_t)y * 668265263u ^ (uint32_t)s * 2246822519u;
  h = (h ^ (h >> 13)) * 1274126177u;
  h ^= h >> 16;
  return h / 4294967296.0;
}
/* RNG de la partida (xorshift64*), con semilla: la simulación no usa otro azar. */
typedef struct { uint64_t s; double fix; } Rng;   /* fix > 0: siempre ese valor (sólo los bancos) */
static inline void rng_seed(Rng *r, uint64_t seed) { r->s = seed * 0x9E3779B97F4A7C15ull | 1; }
static inline double rng_next(Rng *r) {   /* [0,1) */
  if (r->fix > 0) return r->fix;
  r->s ^= r->s >> 12; r->s ^= r->s << 25; r->s ^= r->s >> 27;
  return (r->s * 0x2545F4914F6CDD1Dull >> 11) * (1.0 / 9007199254740992.0);
}
static inline double rng_range(Rng *r, double a, double b) { return a + rng_next(r) * (b - a); }
static inline int rng_int(Rng *r, int a, int b) { return a + (int)(rng_next(r) * (b - a + 1)); }   /* [a,b] */

/* ---------------- datos (data.c, generado) ---------------- */
enum Liq { LIQ_WATER, LIQ_SWAMP, LIQ_LAVA, LIQ_POISON, LIQ_SPARK, LIQ_ICE };
/* Tipos Pokémon, en el orden de G.U.TYPE_COLOR; en máscaras de bits (1u << TY_FIRE). */
enum Type { TY_NORMAL, TY_FIRE, TY_WATER, TY_GRASS, TY_ELECTRIC, TY_ICE, TY_FIGHTING, TY_POISON, TY_GROUND, TY_FLYING,
            TY_PSYCHIC, TY_BUG, TY_ROCK, TY_GHOST, TY_DRAGON, TY_DARK, TY_STEEL, TY_FAIRY, TY_N };
typedef struct { const char *id; unsigned char liquid; double pools, pillars, clear, tree, rock, grass; } ArenaTheme;
extern const int core_n_biomes, core_arena0, core_hw0, core_n_arenas;
extern const unsigned char core_biome_liquid[];
extern const ArenaTheme core_arena_themes[];

/* ---------------- mundo (world.c = G.World) ---------------- */
enum { TER_FLOOR, TER_WALL, TER_LIQUID };
enum { PROP_TREE, PROP_ROCK, PROP_CHEST, PROP_PUMPKIN, PROP_GRASS, PROP_ALTAR, PROP_SPRING, PROP_BIGCHEST, PROP_TRAP, PROP_N };
#define WORLD_N 16            /* tiles por trozo */
#define WORLD_TS 32           /* tile en el mundo (G.Tiles.T 16 × G.Sprites.PX 2) */
#define WORLD_CW (WORLD_N * WORLD_TS)
#define WORLD_MENU_SEED 4242

typedef struct {
  int id, type, tx, ty, kind;
  double x, y, r, hp, maxHp;   /* hp INFINITY: indestructible */
  bool solid, flat, destructible, used;
  double charge, open;         /* altar / manantial / cofre con candado (systems/interact.js) */
} Prop;
/* Efecto del charco sobre un Pokémon (G.World.liquidEffect): dmg en % de vida máxima. Todo 0: nada. */
typedef struct { double slow, dmg, flat, every; bool slide; } LiqFx;

void world_reset(int32_t seed);
void world_halloween(bool on, bool in_run);       /* G.Halloween.on / inRun: calabazas */
void world_set_biome(int i);
int world_biome(void);
int world_liquid(void);                           /* enum Liq del bioma actual */
/* Arena de la grieta (tiles); theme: índice en core_arena_themes. r <= 0: sin arena. */
void world_set_arena(double tx, double ty, double r, int theme);
int world_terrain(int32_t tx, int32_t ty);        /* TER_* */
bool world_walkable(int32_t tx, int32_t ty);
bool world_is_free(double x, double y, double r, bool allow_liquid);
bool world_collide(double *x, double *y, double r);   /* empuja fuera de paredes y sólidos; true si chocó */
/* 0 nada, 1 pared, 2 objeto sólido (en *hit). */
int world_projectile_block(double x, double y, double r, Prop **hit);
/* Los punteros a Prop valen hasta que se genere otro trozo: no guardarlos de un paso a otro (usar id o tx/ty). */
int world_props_in_circle(double x, double y, double r, Prop **out, int max);   /* destructibles vivos */
int world_specials_near(double x, double y, double r, Prop **out, int max);     /* altar, manantial, cofre, trampa */
Prop *world_nearest_breakable(double x, double y, double r);
Prop *world_prop_at(int32_t tx, int32_t ty);      /* el sólido de esa casilla */
const Prop *world_chunk_props(int32_t cx, int32_t cy, int *n);   /* los del trozo, en orden (para pintarlos) */
/* Daña un objeto; si se rompe, lo quita, lo copia en *gone (para el botín) y devuelve true. */
bool world_damage_prop(Prop *p, double amount, Prop *gone);
void world_remove_prop(Prop *p, Prop *gone);      /* quitarlo sin más (trampas, cofre con candado) */
bool world_halloween_run(void);                   /* ¿partida de Halloween? (caramelos) */
extern bool sim_god;                              /* Trucos → Invencible: player_hurt no hace nada (core_god) */
LiqFx world_liquid_effect(uint32_t types);

/* ---------------- utilidades (como G.U) ---------------- */
/* Math.hypot del JS (V8: escala por el mayor y suma de Kahan), para salir igual que él. */
static inline double js_hypot(double a, double b) {
  a = a < 0 ? -a : a; b = b < 0 ? -b : b;
  const double m = a > b ? a : b;
  if (m == 0) return 0;
  double sum = 0, comp = 0;
  const double v[2] = { a / m, b / m };
  for (int i = 0; i < 2; i++) { const double s = v[i] * v[i] - comp, p = sum + s; comp = (p - sum) - s; sum = p; }
  return __builtin_sqrt(sum) * m;
}
static inline double u_clamp(double v, double a, double b) { return v < a ? a : v > b ? b : v; }
static inline double u_dist2(double ax, double ay, double bx, double by) { const double dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
/* G.U.norm: [0,0] si es nulo. */
static inline void u_norm(double x, double y, double *ox, double *oy) {
  const double m = js_hypot(x, y);
  if (m > 1e-6) { *ox = x / m; *oy = y / m; } else { *ox = 0; *oy = 0; }
}

/* ---------------- datos del combate (data.c, generado de js/app.js) ---------------- */
/* Pokédex: pa/sa ataque físico/especial, df/sd defensas (-1: sin dato). */
typedef struct { bool on; uint32_t types; double hp, atk, spd, pa, sa, df, sd; } DexStat;
extern const int core_max_dex;
extern const DexStat core_dex[];
static inline const DexStat *dex_of(int d) { return d > 0 && d <= core_max_dex && core_dex[d].on ? &core_dex[d] : NULL; }
extern const double core_type_chart[TY_N][TY_N];   /* 2, 0.5, 0 o 1 (G.Types.CHART) */

enum MoveKind { MK_PROJECTILE, MK_MELEE, MK_BEAM, MK_NOVA, MK_AURA, MK_BUFF, MK_BOOMERANG, MK_CHAIN, MK_MINE, MK_METEOR, MK_TURRET,
                MK_DASH, MK_TRAIL, MK_CONE, MK_HOMING, MK_BOUNCE, MK_CHARGE, MK_SPIN, MK_QUAKE, MK_VORTEX, MK_SHOVE, MK_STUN,
                MK_ORBIT, MK_N };
enum Buff { BF_ATK, BF_PATK, BF_SATK, BF_SPD, BF_DEF, BF_REGEN, BF_N };
enum Cat { CAT_NONE, CAT_PHYS, CAT_SPEC };
/* Un ataque a un nivel (G.Moves.instance, con las mejoras ya aplicadas). */
typedef struct {
  double cd, dmg, radius, arc, width, knock, slow, burn, poison, speed, count, spread, pierce, life, size, homing, amount,
         dur, stacks, hex, drain, rate, range, charge, pull, stun, bounce;
  int stat;                    /* enum Buff (potenciadores) */
} MoveStat;
#define MOVE_MAXLV 5
typedef struct { const char *id; int kind, type, cat, maxLvl; bool evolves; MoveStat lv[MOVE_MAXLV + 1]; } MoveDef;   /* lv[maxLvl]: evolucionado */
extern const int core_n_moves;
extern const MoveDef core_moves[];
int move_find(const char *id);   /* índice en core_moves o -1 */

/* ---------------- la partida (sim.c: jugadores, caminos y enemigos; combat.c: ataques y daño) ---------------- */
#define MAXPL 4
#define MAXEN 1024
#define MAXPR 2048
#define MAXFI 256
#define MAXEV 4096
#define MAXPU 420   /* objetos en el suelo; al pasar, se juntan los de experiencia más viejos */

/* Lo que manda cada mando en un paso. ax, ay: el stick (largo <= 1). aimx, aimy: apuntar a mano (0, 0: solo). */
typedef struct { double ax, ay, aimx, aimy; uint32_t btn; } CoreInput;

typedef struct { int def, lvl; bool evo; double t, dealt; } PMove;   /* un ataque aprendido (t: su recarga) */
static inline const MoveStat *pm_stat(const PMove *m) { const MoveDef *d = &core_moves[m->def]; return &d->lv[m->evo ? d->maxLvl : m->lvl - 1]; }

/* Objetos (G.Items.LIST) y esferas (G.Orbs.LIST), en su orden. Clima (G.Weather.KINDS). */
enum Item { IT_LEFTOVERS, IT_CHOICEBAND, IT_QUICKCLAW, IT_FOCUSSASH, IT_SHELLBELL, IT_AMULETCOIN, IT_LUCKYEGG, IT_LIFEORB,
            IT_CHOICESCARF, IT_ROCKYHELMET, IT_ASSAULTVEST, IT_N };
enum Orb { ORB_SLUMBER, ORB_SLOW, ORB_BLOWBACK, ORB_FOCUS, ORB_LUMINOUS, ORB_QUICK, ORB_N };
#define ORB_SLOTS 4
enum Power { POW_DMG, POW_SPD, POW_MAG, POW_CD };   /* G.Interact.POWERS: daño ×2, +45 % velocidad, imán ×4, −40 % recarga */
enum Wx { WX_NONE, WX_SUN, WX_RAIN, WX_SAND, WX_SNOW, WX_FOG };

#define MAXMV 8
#define MAXSLOT 4
typedef struct {
  bool on, dead;
  int dex; uint32_t types; const DexStat *mon;
  double x, y, r, baseSpd, spdMul;
  double svx, svy;                     /* velocidad (con hielo cambia despacio) */
  double vx, vy, px, py; bool moved;   /* velocidad suavizada (_vx de EnemyMgr: los corredores te cortan el paso) */
  double moveAngle, aim; bool walking, inLiquid, manualAim; double lavaTick;
  double slowT;                        /* pegado por una trampa */
  double bn[BF_N], bt[BF_N], bamt[BF_N];   /* mejoras temporales (buffs): cargas, tiempo, cuánto */
  double view;                         /* radio de su vista (rezagados, proyectiles), lo pone quien pinta */
  /* combate */
  double hp, maxHp, baseAtk, atkMul, cdMul, dmgReduce, critChance, invuln, reviveT, dmgDealt;
  int level, kills;
  PMove mv[MAXMV]; int nmv;
  int slot[MAXSLOT][MAXMV], slotn[MAXSLOT], nslot, active;   /* huecos: cada uno, ataques (índices en mv) que van a la vez */
  bool hasTarget; int targetId; double tx, ty;   /* blanco: enemigo (id) o un objeto del escenario (0) */
  int lastPatch; double orbCastT;
  double magnet, xpMul, coins, t1, t10, regenFlat;   /* radio del imán, × experiencia; lo recogido en la partida */
  CoreInput in;
  /* habilidad (abil.c: G.AbilityFX), objeto (G.Items) y esferas (G.Orbs); lo que se fija al empezar o al ponerse un
   * objeto (vida, ataque, crítico, imán…) lo aplica el JS en su G.Player y llega por core_stats */
  int ab, abType;                      /* ab: fila de abil.c (-1: la genérica); abType: su tipo principal */
  double moxie, boostT, abSpd, ssT, stanceT, moodT, shedT, sturdyAt, sashT, bellHeal;
  bool shieldForm, angry, boomed; int mood;
  int item;                            /* enum Item (-1: ninguno) */
  int orbId[ORB_SLOTS], orbN[ORB_SLOTS]; double orbCd, orbT[ORB_N];   /* bolsa (id -1: hueco libre) y mejoras con tiempo */
  int power; double powerT, springAcc, springShown;   /* poder de altar (-1: ninguno, si no enum Power) y lo que dura;
                                                         lo curado por un manantial (se enseña cada 0,6 s) */
  double candy;                        /* caramelos cogidos */
} Player;

/* Personalidades (G.Enemies.behaviorOf). */
enum Beh { BEH_CHASE, BEH_TANK, BEH_CHARGER, BEH_RUNNER, BEH_THIEF, BEH_RANGED, BEH_FAN, BEH_BEAMER, BEH_ZONER, BEH_HEALER,
           BEH_SUMMONER, BEH_SHIELDER, BEH_JUMPER, BEH_BOMBER, BEH_REMOTE, BEH_N };
enum { PH_WALK, PH_AIM, PH_DASH, PH_FUSE };
/* Ataques de los jefes (Enemy.bossInit). */
enum { BA_SLAM, BA_DASH, BA_LEAP, BA_RAIN, BA_BEAM, BA_NOVA, BA_VOLLEY, BA_NONE = -1 };
typedef struct {
  int id, dex, beh; uint32_t types; const DexStat *mon;
  bool dead, boss, flying, shiny, legend, judge, golden, loot10, arceus;   /* arceus: el blanco de Arceus (no cae) */   /* loot10: el ladrón suelta un ticket ×10 */
  double x, y, r, hp, maxHp, spd, dmg, xp, range, shotCd0, shotDmg, fanN;
  int atkType, cat;                    /* tipo y categoría de sus golpes */
  double slow, slowT, sleepT, stunT, kx, ky;
  double burn, burnT, burnTick, poison, poisonT, poisonTick, lavaTick, touchCd, shield, shieldT, rd;
  int phase; double pt, dx, dy;        /* embestida */
  double shotCd, stuckT, sideT, zig, life, lagT; int side;
  double losAt; bool los;              /* G.Path: vista despejada hasta el jugador */
  double vx, vy;                       /* lo que quiso moverse en el último paso (para pintar) */
  int lastHit;                         /* el último jugador que le pegó (a quién va la muerte) */
  int zones; double skillCd;           /* zonas del que las lanza; espera de escudos / saltos */
  bool jumping; double jsx, jsy, jtx, jty, jt, jdur, jumpLift;   /* salto: de dónde, a dónde, tiempo (< 0: agachado) */
  /* jefes (Enemy.ai): ataques de cerca y de lejos, distancia que prefiere, furia y el ataque en curso */
  bool aiOn, aiFar, fury; int aiMelee[2], aiRanged[2], aiSide; double farLike, modeT, aiCd;
  int cast; bool cgo, cfired; double ct, cwind, cafter, cang, clen, cdur;
} Enemy;

#define PR_HITS 64
typedef struct {
  int id, owner, move, src;            /* owner: jugador (-1: disparo enemigo); move: core_moves (-1); src: índice en su mv */
  bool friendly, orb, back, moved;
  double x, y, vx, vy, px, py, dmg, r, life, t, homing, slow, burn, poison, knock, drain, boom, bsp;
  double oa, orad, ospeed, rehit;
  int pierce, bounce, mtype, mcat;
  int hits[PR_HITS], nhits;            /* enemigos ya tocados (anillo) */
  int phits[16], nphits;               /* objetos ya tocados */
  int logk[32]; double logt[32]; int nlog;   /* órbitas: cuándo tocó a cada uno (rehit) */
} Proj;

enum FieldKind { FK_MINE, FK_METEOR, FK_TURRET, FK_PATCH, FK_CHARGE, FK_SPIN, FK_QUAKE, FK_VORTEX, FK_STUNZONE };
typedef struct {
  int kind, owner, mv, id;             /* mv: índice en el mv de su dueño */
  bool gone;
  double x, y, t, life, r, dmg, arm, fall, shotT, tick, at, next, a, ca, sa, pull, delay;
  int n, i;
} Field;

/* Lo que pasa en un paso y el JS tiene que ver (números, efectos, animaciones, botín). */
enum EvKind { EV_CAST, EV_HIT, EV_KILL, EV_PHURT, EV_PDEAD, EV_PREVIVE, EV_PROP, EV_SLASH, EV_BEAM, EV_RING, EV_DASH, EV_BLAST,
              EV_HEAL, EV_SHOT, EV_PICK, EV_LEVEL, EV_ORB, EV_FX, EV_HAZARD, EV_EANIM, EV_SUMMON, EV_ENRAGE, EV_TRAP, EV_POWER, EV_GONE };   /* EV_PICK: who recogió (id: PickKind, a: valor);
                                                                        EV_LEVEL: a = nivel; EV_ORB: who usó la esfera id (a: radio);
                                                                        EV_FX: id = enum Fx (a: dato);
                                                                        EV_HAZARD: se cumple el aviso id; EV_EANIM: el enemigo id
                                                                        anima a (0 Charge, 1 Attack, 2 Shoot) a velocidad b;
                                                                        EV_SUMMON: el enemigo id invoca (lo hace el JS);
                                                                        EV_ENRAGE: el jefe id se enfurece;
                                                                        EV_TRAP: salta una trampa (a: cuál, 0-2);
                                                                        EV_POWER: who coge el poder a; EV_GONE: el
                                                                        enemigo id se escapa (el ladrón) */
enum Fx { FX_DODGE, FX_SASH, FX_STURDY, FX_ANGRY, FX_MOOD, FX_BOOM, FX_ORB_CD, FX_STICKY, FX_DRY, FX_CHIP };

/* Objetos en el suelo (G.Pickups). PK_ITEM y PK_SPHERE: cuál es lo decide quien pinta al recogerlo. */
enum PickKind { PK_XP, PK_XPBIG, PK_HEAL, PK_MAGNET, PK_BOMB, PK_COIN, PK_TICKET, PK_TICKET10, PK_ITEM, PK_SPHERE, PK_CANDY, PK_N };
typedef struct { int id, kind; double x, y, vx, vy, t, value; bool pulled; } Pickup;
typedef struct { int k, who, id; double x, y, a, b, c; } Ev;

/* Zonas y rayos con aviso (G.Hazards): golpean a todos los jugadores que pillen al cumplirse el aviso. */
enum { HZ_ZONE, HZ_BEAM };
typedef struct {
  int id, kind, type, cat, vis;        /* vis 1: pilar de luz (la Sentencia) */
  double x, y, r, angle, len, w, delay, dmg, pct, t, end;
  bool hit, pure, boom;                /* boom: explosión de un kamikaze (Humedad no la nota) */
} Hazard;
#define MAXHZ 256

typedef struct {
  Rng rng;
  double time;
  int np; Player pl[MAXPL];
  int ne; Enemy en[MAXEN];             /* vivos, en el orden del JS (importa en la separación) */
  int npr; Proj pr[MAXPR];
  int nfi; Field fi[MAXFI];
  int nev; Ev ev[MAXEV];               /* los que el JS aún no ha leído (core_events los vacía) */
  int npu; Pickup pu[MAXPU + 1];
  double xp, xpNext; int level, pending;   /* experiencia y nivel del equipo (en grupo es de todos); pending: cartas por abrir */
  bool halloween;                      /* caramelos */
  int nhz; Hazard hz[MAXHZ];
  int wx; double wxLv;
  double chipT, candyDropped;
  bool inArena, judge, arcShield; double arcK;   /* grieta o Sentencia; a Arceus: ¿legendarios vivos? y lo que recibe */          /* arena / nieve: cada 2 s; caramelos que van con el tiempo (Halloween) */                 /* clima (enum Wx) y su intensidad 0..1 (G.Weather, lo pone el JS) */
  int next_id, next_pr, next_fi, next_pu, next_hz;
} Sim;
extern Sim S;

void sim_reset(int32_t seed);
int sim_add_player(int dex, uint32_t types, double x, double y, double r, double spd);
bool player_learn(Player *p, int move_def, int lvl);   /* un ataque nuevo en un hueco nuevo (como addMove) */
void player_set_active(Player *p, int slot);
bool player_set_slots(Player *p, const char *layout, int active);   /* "id,id;id;id": los huecos (vínculos: varios a la vez) */
int sim_add_enemy(const Enemy *e);     /* copia la plantilla (stats, sitio, personalidad); devuelve su id o 0 si no cabe */
void sim_step(double dt);
int sim_nearest_player(double x, double y);   /* -1 si no hay vivos */
int sim_query_circle(double x, double y, double r, int *out, int max);   /* índices en S.en */
Enemy *sim_enemy(int id);
void sim_event(int k, int who, int id, double x, double y, double a, double b, double c);
/* El estado para quien pinta: [np, ne, npr, nfi, npu, nivel, xp, xp del siguiente, cartas pendientes, jugadores, enemigos,
 * proyectiles, campos, objetos]; sim_pack_len() doubles. */
#define SIM_PL 38  /* x, y, aim, moveAngle, andando, en el agua, vivo, vida, vida máx., invulnerable, hueco activo,
                      monedas, tickets, tickets ×10, derrotados, objeto, 4 × (esfera, cuántas), espera de esfera,
                      Focosfera, Luminosfera, Rapidosfera (segundos que les quedan), poder de altar, lo que le queda,
                      caramelos, 6 × cargas de mejora (BF_*), reviviendo (s) */
#define SIM_EN 17  /* id, dex, x, y, vx, vy, fase, caído, vida, vida máx., escudo, altura del salto, furia, dormido,
                      aturdido, quemado, envenenado */
#define SIM_HZ 13  /* id, tipo, x, y, r, ángulo, largo, ancho, t, aviso, ya golpeó, tipo del golpe, (boom | pilar << 1) */
#define SIM_PR 10  /* id, dueño, ataque, x, y, vx, vy, radio, amigo, órbita */
#define SIM_FI 9   /* id, tipo, dueño, ataque, x, y, radio, t, vida */
#define SIM_PU 6   /* id, tipo, x, y, t, valor */
size_t sim_pack_len(void);   /* (los avisos van al final: [nhz] y SIM_HZ por aviso) */
void sim_pack(double *out);

/* Por partes (el banco las llama sueltas). */
void player_update(Player *p, double dt);
void player_hurt(Player *p, double amount, int type, bool pure, int cat);
void player_heal(Player *p, double amount);
double player_atk_for(const Player *p, int type, int cat);
void path_update(double dt);
void path_build(int pi);
bool path_dir(Enemy *e, int pi, double *dx, double *dy);
void enemy_update(Enemy *e, int pi, double dt);
void enemy_hurt(Enemy *e, double amount, double dx, double dy, double knock, int by);
void enemy_grid(void);
void enemy_separate(double dt);
double type_mult(int atk, uint32_t def);
double stats_taken(const DexStat *mon, int cat);
void combat_tick(Player *p, double dt);
void combat_fields(double dt);
void combat_resolve(double dt);
void proj_update(double dt);
void pickup_update(double dt);
void pickup_drop(int kind, double x, double y, double value);
void pickup_drop_xp(double x, double y, double value, bool boss, bool legend, bool plain);
void pickup_prop_loot(const Prop *p);     /* el botín de un objeto del escenario roto */
void pickup_collect(const Pickup *p, int who);
double xp_for(int level);                 /* G.Player.xpFor */
int proj_nearest(double x, double y, double max);   /* enemigo vivo más cercano (índice en S.en) o -1 */
const int16_t *path_field(int pi, int32_t *ox, int32_t *oy);   /* PATH_N × PATH_N pasos (0x7fff: sin camino) */
#define PATH_R 28
#define PATH_N (PATH_R * 2 + 1)

/* Habilidades (abil.c = G.AbilityFX), objetos y esferas. cls: 'p' físico, 's' especial, 0 sin categoría; type -1: sin tipo. */
int abil_find(const char *id);            /* fila de la habilidad o -1 (la genérica: +8 % con su tipo principal) */
void player_set_ability(Player *p, int ab, int type0);
enum { AF_STEADY = 1, AF_LEVITATE = 2, AF_LAVAPROOF = 4, AF_STURDY = 8, AF_SHEER = 16, AF_SERENE = 32, AF_DAMP = 64,
       AF_TOUCHPOISON = 128, AF_TRAPPROOF = 256 };
int abil_flags(const Player *p);
double abil_out(Player *p, const PMove *m, const Enemy *e);   /* × al daño que hace (puede tirar azar: Entusiasmo) */
double abil_in(const Player *p, int type, int cls);         /* × al daño que recibe */
int abil_absorb(const Player *p);                           /* tipo que le cura en vez de dañar, o -1 */
bool abil_has_dodge(const Player *p);
double abil_dodge(const Player *p, int type, int cls);
double abil_speed(const Player *p);
double abil_heal_mul(const Player *p);
double abil_status_cd(const Player *p);                     /* × a la recarga de los potenciadores */
double abil_crit_mul(const Player *p);
void abil_hurt(Player *p, int type, int cls);               /* le acaban de golpear (sigue vivo) */
void abil_contact(Player *p, Enemy *e);                     /* un enemigo le ha golpeado cuerpo a cuerpo */
void abil_hit(Player *p, Enemy *e, const PMove *m);         /* ha golpeado a e (con el touchPoison) */
void abil_kill(Player *p, const Enemy *e);
void abil_tick(Player *p, double dt);
int sim_wx(void);                         /* el clima que cuenta (WX_NONE si no se nota todavía) */
double wx_mult(int type);                 /* G.Weather.mult */
double wx_speed(uint32_t types);          /* G.Weather.speedFor */
void add_buff(Player *p, int stat, double amount, double dur, int max);
void apply_slow(Enemy *e, double f, double dur);
void apply_burn(Enemy *e, double n);
void apply_poison(Enemy *e, double n);
bool orb_can_take(const Player *p, int id);
bool orb_add(Player *p, int id);
bool orb_use(int who, int slot, double hw, double hh);   /* hw, hh: media vista de quien la usa (para las de enemigos) */
void orb_update(Player *p, double dt);

/* foe.c: personalidades (rayo, zonas, escudos, salto, kamikaze), jefes y avisos (G.Hazards). */
void sim_stash(void);                     /* EnemyMgr.stash / restore: los del mapa, mientras dura una arena */
void sim_restore(void);
void sim_clear(int what);                 /* 1 proyectiles, 2 campos, 4 avisos, 8 lo del suelo */
int hazard_add(const Hazard *h);          /* id o 0 si no cabe */
void hazards_update(double dt);
void enemy_kill(Enemy *e);                /* cae (botín, a quién cuenta): Enemy.die */
void foe_special(Enemy *e, const Player *pl, double dx, double dy);   /* Enemy.special */
bool foe_skills(Enemy *e, const Player *pl, double dist, double dt);  /* escudos, salto, mecha: true = ya se ha movido */
void foe_boss_move(Enemy *e, const Player *pl, double dt, double dist, double dx, double dy, double spd, double *vx, double *vy);
void enemy_shoot(const Enemy *e, double ax, double ay, double spread, int n, double k);

/* map.c: lo que hay en el mapa (G.Interact: altares, manantiales, cofre con candado, trampas), el clima que daña
 * (arena, nieve) y los caramelos de Halloween. */
void interact_update(double dt);
void weather_chip(double dt);
bool candy_take(double need);             /* G.Halloween.takeCandy */
void power_apply(Player *p, int sign);    /* el poder de altar a sus stats (+1 al ponerlo, -1 al quitarlo) */

#endif
