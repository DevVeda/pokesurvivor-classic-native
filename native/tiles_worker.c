/* tiles_worker.c — el suelo del mapa, pintado en otro hilo.
 *
 * G.Tiles.paintChunk pinta píxel a píxel un trozo de suelo de 256x256: en QuickJS son 150-230 ms,
 * y al moverse por el mapa salían varios seguidos (tirones de medio segundo). Aquí corre en un
 * hilo con su propio QuickJS, que carga util.js, tiles.js y world.js (native/shim/tiles-worker.js):
 * con la misma semilla y la misma arena, el mismo suelo, píxel a píxel (comprobado).
 * El juego recibe en el acto un lienzo del color del suelo (native/shim/boot.js) y éste lo rellena.
 *
 *   ps.tw_paint(lienzo, cx, cy, bioma, semilla)   pintar un trozo de ese mundo en ese lienzo
 *   ps.tw_arena(semilla, json|null)               la arena de la grieta de ese mundo
 *
 * WORKERS hilos a la vez, cada uno con su QuickJS y su copia del mundo: al empezar una run se ven
 * 15-20 trozos y de uno en uno tardaban 2-3 s en salir. Cada trabajo lleva su semilla (se puede pintar
 * la run siguiente mientras el menú usa otro mundo); cada hilo cambia de mundo si hace falta.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "quickjs.h"
#include "canvas.h"
#include "tiles_worker.h"
#include "update.h"

#define QLEN 512
#ifndef WORKERS     // (Switch: 2, -DWORKERS en Makefile.switch: 3 núcleos y cada hilo carga el juego entero)
#define WORKERS 6   // (pintar el suelo y generar el terreno: la PS5 tiene núcleos de sobra; con 3, al empezar se veía pintar)
#endif

typedef struct { int sid; unsigned gen; int cx, cy, bi, seed; void *owner; } job_t;   // sid < 0: generar el trozo (tw_gen), no pintarlo
// (owner: el contexto JS que lo pidió; con jugador 2 hay dos juegos usando estos hilos)

// Trozos de terreno generados por los hilos (psGen de tiles-worker.js, en JSON), para que el juego los recoja (tw_gen_poll):
// en el hilo del juego cada uno costaba 35-50 ms y no se podía partir (tirones al andar y al volver al menú).
typedef struct res { struct res *next; int seed, cx, cy; char *json; void *owner; } res_t;
static res_t *r_head, *r_tail;
static pthread_mutex_t r_mx = PTHREAD_MUTEX_INITIALIZER;

static job_t q[QLEN];
static int qhead, qtail;
static pthread_mutex_t q_mx = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t q_cv = PTHREAD_COND_INITIALIZER;
static const char *root;
// La arena de la grieta (la de un mundo: su semilla), con su versión.
static char *st_arena;
static int st_arena_seed;
static unsigned st_ver;
static void (*say)(const char *fmt, ...);

static void
push(job_t j) {
  pthread_mutex_lock(&q_mx);
  if((qtail + 1) % QLEN != qhead) { q[qtail] = j; qtail = (qtail + 1) % QLEN; pthread_cond_signal(&q_cv); }
  else say("[suelo] cola llena: se pierde un trozo\n");
  pthread_mutex_unlock(&q_mx);
}

static double
num(JSContext *ctx, JSValueConst v) { double d = 0; JS_ToFloat64(ctx, &d, v); return d; }

static char*
read_file(const char *path, size_t *len) {
  char ov[800];
  FILE *f = fopen(upd_path(path, ov, sizeof ov), "rb");   // (la versión instalada, si la hay: update.c)
  char *buf;
  long n;
  if(!f) return NULL;
  fseek(f, 0, SEEK_END); n = ftell(f); fseek(f, 0, SEEK_SET);
  if(n < 0 || !(buf = malloc(n + 1))) { fclose(f); return NULL; }
  *len = fread(buf, 1, n, f);
  buf[*len] = 0;
  fclose(f);
  return buf;
}

static void
report(JSContext *ctx, const char *where) {
  JSValue e = JS_GetException(ctx), st = JS_GetPropertyStr(ctx, e, "stack");
  const char *m = JS_ToCString(ctx, e), *s = JS_ToCString(ctx, st);
  say("[suelo] %s: %s\n%s\n", where, m ? m : "?", s ? s : "");
  JS_FreeCString(ctx, m); JS_FreeCString(ctx, s);
  JS_FreeValue(ctx, st); JS_FreeValue(ctx, e);
}

// ---------------- lo que ve el JS del hilo ----------------

static JSValue
w_load(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *path = JS_ToCString(ctx, argv[0]);
  size_t len;
  char *src = path ? read_file(path, &len) : NULL;
  JSValue r = src ? JS_Eval(ctx, src, len, path, JS_EVAL_TYPE_GLOBAL) : JS_ThrowReferenceError(ctx, "no se encuentra %s", path ? path : "?");
  free(src);
  JS_FreeCString(ctx, path);
  return r;
}

// ps.readFile(ruta) -> texto o null (js/files.js y las fuentes del suelo: tiles-worker.js).
static JSValue
w_read(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *path = JS_ToCString(ctx, argv[0]);
  size_t len;
  char *src = path ? read_file(path, &len) : NULL;
  JSValue r = src ? JS_NewStringLen(ctx, src, len) : JS_NULL;
  free(src);
  JS_FreeCString(ctx, path);
  return r;
}

static JSValue
w_log(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *s = JS_ToCString(ctx, argv[0]);
  if(s) say("[suelo] %s\n", s);
  JS_FreeCString(ctx, s);
  return JS_UNDEFINED;
}

static void*
worker(void *arg) {
  JSRuntime *rt = JS_NewRuntime();
  JSContext *ctx = JS_NewContext(rt);
  JSValue global = JS_GetGlobalObject(ctx), ps = JS_NewObject(ctx), paint, state;
  char path[600];
#ifdef _WIN32
  JS_SetMaxStackSize(rt, 0);   // (como main.c: en Windows el cálculo del límite da la vuelta)
#else
  JS_SetMaxStackSize(rt, 2 << 20);
#endif
  JS_SetPropertyStr(ctx, ps, "load", JS_NewCFunction(ctx, w_load, "load", 1));
  JS_SetPropertyStr(ctx, ps, "log", JS_NewCFunction(ctx, w_log, "log", 1));
  JS_SetPropertyStr(ctx, ps, "readFile", JS_NewCFunction(ctx, w_read, "readFile", 1));
  JS_SetPropertyStr(ctx, ps, "ROOT", JS_NewString(ctx, root));
  JS_SetPropertyStr(ctx, global, "ps", ps);
  snprintf(path, sizeof path, "%s/shim/tiles-worker.js", root);
  {
    JSValue a = JS_NewString(ctx, path), r = w_load(ctx, global, 1, &a);
    if(JS_IsException(r)) report(ctx, "arranque");
    JS_FreeValue(ctx, r);
    JS_FreeValue(ctx, a);
  }
  paint = JS_GetPropertyStr(ctx, global, "psPaint");
  state = JS_GetPropertyStr(ctx, global, "psState");
  JSValue genf = JS_GetPropertyStr(ctx, global, "psGen");

  unsigned mine = 0;    // la versión de la arena que tiene este hilo
  int seed = 0;         // el mundo que tiene cargado
  for(;;) {
    job_t j;
    char *arena = NULL, msg[600];
    unsigned ver;
    int arena_seed;
    pthread_mutex_lock(&q_mx);
    while(qhead == qtail) pthread_cond_wait(&q_cv, &q_mx);
    j = q[qhead];
    qhead = (qhead + 1) % QLEN;
    ver = st_ver; arena_seed = st_arena_seed;
    if(j.seed != seed || ver != mine) arena = st_arena ? strdup(st_arena) : NULL;
    pthread_mutex_unlock(&q_mx);

    if(j.seed != seed || ver != mine) {
      // Otro mundo (o la arena cambió): se vuelve a montar con su semilla y, si es la suya, su arena.
      snprintf(msg, sizeof msg, "{\"seed\":%d,\"arena\":%s}", j.seed, arena && arena_seed == j.seed ? arena : "null");
      {
        JSValue a = JS_NewString(ctx, msg), r = JS_Call(ctx, state, global, 1, &a);
        if(JS_IsException(r)) report(ctx, "estado");
        JS_FreeValue(ctx, r);
        JS_FreeValue(ctx, a);
      }
      seed = j.seed; mine = ver;
    }
    free(arena);
    if(j.sid < 0) {   // generar el trozo y dejarlo en la lista de resultados
      JSValue a[3] = { JS_NewInt32(ctx, j.cx), JS_NewInt32(ctx, j.cy), JS_NewInt32(ctx, j.bi) };
      JSValue r = JS_IsFunction(ctx, genf) ? JS_Call(ctx, genf, global, 3, a) : JS_UNDEFINED;
      if(JS_IsException(r)) { report(ctx, "generar"); continue; }
      const char *s = JS_IsString(r) ? JS_ToCString(ctx, r) : NULL;
      res_t *o = s ? malloc(sizeof *o) : NULL;
      if(o && (o->json = strdup(s))) {
        o->next = NULL; o->seed = j.seed; o->cx = j.cx; o->cy = j.cy; o->owner = j.owner;
        pthread_mutex_lock(&r_mx);
        if(r_tail) r_tail->next = o; else r_head = o;
        r_tail = o;
        pthread_mutex_unlock(&r_mx);
      } else free(o);
      JS_FreeCString(ctx, s);
      JS_FreeValue(ctx, r);
      continue;
    }
    if(canvas_gen(j.sid) != j.gen) continue;   // el lienzo ya no existe: no hace falta pintarlo
    {
      JSValue a[3] = { JS_NewInt32(ctx, j.cx), JS_NewInt32(ctx, j.cy), JS_NewInt32(ctx, j.bi) };
      JSValue r = JS_Call(ctx, paint, global, 3, a);
      if(JS_IsException(r)) { report(ctx, "pintar"); continue; }
      // r = { width, height, data: Uint8ClampedArray RGBA }
      {
        JSValue d = JS_GetPropertyStr(ctx, r, "data");
        size_t off, len, bpe, size;
        JSValue ab = JS_GetTypedArrayBuffer(ctx, d, &off, &len, &bpe);
        const Uint8 *px = JS_IsException(ab) ? NULL : JS_GetArrayBuffer(ctx, &size, ab);
        int w = (int)num(ctx, JS_GetPropertyStr(ctx, r, "width")), h = (int)num(ctx, JS_GetPropertyStr(ctx, r, "height"));
        if(px && len >= (size_t)w * h * 4) canvas_put_rgba(j.sid, j.gen, px + off, w, h);
        if(JS_IsException(ab)) JS_FreeValue(ctx, JS_GetException(ctx));
        JS_FreeValue(ctx, ab);
        JS_FreeValue(ctx, d);
      }
      JS_FreeValue(ctx, r);
      JS_RunGC(rt);   // aquí no molesta a nadie
    }
  }
  return NULL;
}

// ---------------- lo que ve el JS del juego ----------------

static JSValue
tw_paint(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int sid = (int)num(ctx, argv[0]);
  push((job_t){ sid, canvas_gen(sid), (int)num(ctx, argv[1]), (int)num(ctx, argv[2]), (int)num(ctx, argv[3]), (int)num(ctx, argv[4]) });
  return JS_UNDEFINED;
}

// tw_gen(cx, cy, bioma, semilla): generar ese trozo de terreno en un hilo (bioma + 100: con Halloween).
static JSValue
tw_gen(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  push((job_t){ -1, 0, (int)num(ctx, argv[0]), (int)num(ctx, argv[1]), (int)num(ctx, argv[2]), (int)num(ctx, argv[3]), ctx });
  return JS_UNDEFINED;
}

// tw_gen_poll() -> [[semilla, cx, cy, json], …]: los trozos ya generados desde la última vez.
static JSValue
tw_gen_poll(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  // Sólo los de este contexto; los del otro juego se quedan en la lista.
  res_t *l = NULL, **lt = &l, *keep = NULL, *klast = NULL;
  pthread_mutex_lock(&r_mx);
  for(res_t *o = r_head, *n; o; o = n) {
    n = o->next; o->next = NULL;
    if(o->owner == ctx) { *lt = o; lt = &o->next; }
    else { if(klast) klast->next = o; else keep = o; klast = o; }
  }
  r_head = keep; r_tail = klast;
  pthread_mutex_unlock(&r_mx);
  JSValue arr = JS_NewArray(ctx);
  for(uint32_t i = 0; l; i++) {
    res_t *n = l->next;
    JSValue e = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, e, 0, JS_NewInt32(ctx, l->seed));
    JS_SetPropertyUint32(ctx, e, 1, JS_NewInt32(ctx, l->cx));
    JS_SetPropertyUint32(ctx, e, 2, JS_NewInt32(ctx, l->cy));
    JS_SetPropertyUint32(ctx, e, 3, JS_NewString(ctx, l->json));
    JS_SetPropertyUint32(ctx, arr, i, e);
    free(l->json); free(l);
    l = n;
  }
  return arr;
}

// tw_arena(semilla, json del objeto arena o null)
static JSValue
tw_arena(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int seed = (int)num(ctx, argv[0]);
  const char *s = JS_IsNull(argv[1]) ? NULL : JS_ToCString(ctx, argv[1]);
  pthread_mutex_lock(&q_mx);
  free(st_arena);
  st_arena = s ? strdup(s) : NULL;
  st_arena_seed = seed;
  st_ver++;
  pthread_mutex_unlock(&q_mx);
  JS_FreeCString(ctx, s);
  return JS_UNDEFINED;
}

int
tiles_worker_init(JSContext *ctx, JSValue ps, const char *root_dir, void (*log)(const char *fmt, ...)) {
  pthread_t t;
  static int started;   // los hilos se arrancan una vez; al recargar el JS sólo se vuelven a poner las funciones
  root = root_dir;
  say = log;
  if(!started) for(int i = 0; i < WORKERS; i++) started += !pthread_create(&t, NULL, worker, NULL);
  if(!started) return -1;
  JS_SetPropertyStr(ctx, ps, "tw_paint", JS_NewCFunction(ctx, tw_paint, "tw_paint", 5));
  JS_SetPropertyStr(ctx, ps, "tw_arena", JS_NewCFunction(ctx, tw_arena, "tw_arena", 2));
  JS_SetPropertyStr(ctx, ps, "tw_gen", JS_NewCFunction(ctx, tw_gen, "tw_gen", 4));
  JS_SetPropertyStr(ctx, ps, "tw_gen_poll", JS_NewCFunction(ctx, tw_gen_poll, "tw_gen_poll", 0));
  return 0;
}
