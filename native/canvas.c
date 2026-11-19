/* canvas.c — el CanvasRenderingContext2D del navegador, en C sobre PlutoVG.
 *
 * Cada lienzo (la pantalla, los fuera de pantalla y las imágenes cargadas) es una
 * superficie de PlutoVG en ARGB premultiplicado. native/shim/canvas.js da al JS del
 * juego el objeto `ctx` de siempre y llama a estas funciones (ps.cv_*).
 *
 * La matriz la llevamos nosotros y se aplica al añadir cada punto, como hace el
 * navegador (PlutoVG la aplicaría al rellenar). A PlutoVG sólo se le pasa para el
 * texto, los degradados y las imágenes que no van por el atajo.
 *
 * drawImage sin giro, sin recorte y con composición normal va por un blit propio
 * (es lo que más se llama: cada sprite); lo demás, por PlutoVG.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <pthread.h>

#include "plutovg.h"
#include "quickjs.h"
#include "canvas.h"
#include "update.h"
#include "gpu.h"

#define MAX_SURFS 8192   // a la vez: se liberan cuando el JS suelta el lienzo o la imagen (cv_hold)
#define MAX_DEPTH 32

typedef struct { float a, b, c, d, e, f; } mat_t;

typedef struct {
  mat_t m;
  plutovg_color_t fill, stroke;
  plutovg_paint_t *fill_grad, *stroke_grad;   // si no es NULL, manda sobre el color (lleva su matriz dentro)
  unsigned long long fill_gkey, stroke_gkey;   // huella del degradado (para grad_cached)
  float alpha, line_width, font_size;
  int op, bold, align, baseline, clipped;
  int gclip;   // pantalla por GPU: recortada con el stencil (gpu_clip); los atajos de la GPU siguen valiendo
} cstate_t;

typedef struct {
  plutovg_surface_t *s;
  plutovg_canvas_t *c;
  cstate_t st[MAX_DEPTH];
  int sp, has_point;
  unsigned gen;    // cambia al liberarse: un trabajo del hilo del suelo para un lienzo que ya no existe no escribe
  volatile unsigned char painted;   // ya lo pintó el hilo del suelo (cv_painted)
  unsigned long long ph;   // huella del trazado actual (sólo la pantalla por GPU: path_cached), relativa a su primer punto
  float pox, poy;          // (ese primer punto, en píxeles de pantalla)
  int pn;
  unsigned tex;         // su textura en la GPU (gpu.c; 0 = sin subir) y si ha cambiado desde que se subió
  volatile unsigned char dirty;
  plutovg_path_t *rp;   // el trazado aparte de fillRect y compañía (rect_path): uno por lienzo, que cada lienzo es de un
                        // solo juego (con jugadores 2-4 dibujan varios hilos; uno para todos se lo pisaban: cierres)
} surf_t;

static surf_t surfs[MAX_SURFS];
static int n_surfs;                     // huecos usados alguna vez
static int free_ids[MAX_SURFS], n_free; // huecos liberados, para reutilizar
// Alta y baja de lienzos, y la copia desde el hilo del suelo (tiles_worker.c), con este cerrojo.
static pthread_mutex_t surf_mx = PTHREAD_MUTEX_INITIALIZER;
static JSClassID hold_class;
static plutovg_font_face_t *faces[2];         // normal, negrita
static char font_dir[512];

static const plutovg_operator_t OPS[] = {      // el orden de OPS en canvas.js
  PLUTOVG_OPERATOR_SRC_OVER, PLUTOVG_OPERATOR_SRC_IN, PLUTOVG_OPERATOR_SRC_OUT, PLUTOVG_OPERATOR_SRC_ATOP,
  PLUTOVG_OPERATOR_DST_OVER, PLUTOVG_OPERATOR_DST_IN, PLUTOVG_OPERATOR_DST_OUT, PLUTOVG_OPERATOR_DST_ATOP,
  PLUTOVG_OPERATOR_XOR, PLUTOVG_OPERATOR_SRC, PLUTOVG_OPERATOR_CLEAR,
};

// ---------------- utilidades ----------------

static double
num(JSContext *ctx, JSValueConst v) {
  double d = 0;
  JS_ToFloat64(ctx, &d, v);
  return d;
}

static surf_t*
surf(JSContext *ctx, JSValueConst v) {
  int id = (int)num(ctx, v);
  return id >= 0 && id < n_surfs && surfs[id].s ? &surfs[id] : NULL;
}

static cstate_t*
cur(surf_t *s) { return &s->st[s->sp]; }

static void
apply(const mat_t *m, double x, double y, float *ox, float *oy) {
  *ox = (float)(m->a * x + m->c * y + m->e);
  *oy = (float)(m->b * x + m->d * y + m->f);
}

static void
mul(mat_t *m, float a, float b, float c, float d, float e, float f) {   // m = m · [a b c d e f]
  mat_t r = { m->a * a + m->c * b, m->b * a + m->d * b, m->a * c + m->c * d, m->b * c + m->d * d,
              m->a * e + m->c * f + m->e, m->b * e + m->d * f + m->f };
  *m = r;
}

static plutovg_matrix_t
pm(const mat_t *m) {
  plutovg_matrix_t r;
  plutovg_matrix_init(&r, m->a, m->b, m->c, m->d, m->e, m->f);
  return r;
}

static void
reset_state(cstate_t *st) {
  memset(st, 0, sizeof *st);
  st->m = (mat_t){ 1, 0, 0, 1, 0, 0 };
  st->fill = st->stroke = (plutovg_color_t){ 0, 0, 0, 1 };
  st->alpha = 1;
  st->line_width = 1;
  st->font_size = 10;
}

static int
add_surface(plutovg_surface_t *s) {
  surf_t *sf;
  int id;
  unsigned gen;
  if(!s) return -1;
  pthread_mutex_lock(&surf_mx);
  id = n_free ? free_ids[--n_free] : n_surfs < MAX_SURFS ? n_surfs++ : -1;
  if(id < 0) { pthread_mutex_unlock(&surf_mx); plutovg_surface_destroy(s); return -1; }
  sf = &surfs[id];
  gen = sf->gen;
  memset(sf, 0, sizeof *sf);
  sf->gen = gen;
  sf->s = s;
  sf->c = plutovg_canvas_create(s);
  reset_state(&sf->st[0]);
  pthread_mutex_unlock(&surf_mx);
  return id;
}

static void
free_surface(int id) {
  surf_t *sf;
  if(id <= 0 || id >= n_surfs) return;   // la pantalla (0) no se libera nunca
  pthread_mutex_lock(&surf_mx);
  sf = &surfs[id];
  if(sf->s) {
    while(sf->sp) { plutovg_paint_destroy(cur(sf)->fill_grad); plutovg_paint_destroy(cur(sf)->stroke_grad); sf->sp--; }
    plutovg_paint_destroy(cur(sf)->fill_grad); plutovg_paint_destroy(cur(sf)->stroke_grad);
    plutovg_canvas_destroy(sf->c);
    plutovg_surface_destroy(sf->s);
    gpu_delete(sf->tex);
    if(sf->rp) plutovg_path_destroy(sf->rp);
    sf->s = NULL; sf->c = NULL; sf->rp = NULL;
    sf->gen++;
    free_ids[n_free++] = id;
  }
  pthread_mutex_unlock(&surf_mx);
}

static void
hold_finalizer(JSRuntime *rt, JSValue v) {
  free_surface((int)(intptr_t)JS_GetOpaque(v, hold_class) - 1);
}

unsigned
canvas_gen(int id) {
  unsigned g;
  pthread_mutex_lock(&surf_mx);
  g = id >= 0 && id < n_surfs ? surfs[id].gen : 0;
  pthread_mutex_unlock(&surf_mx);
  return g;
}

// Desde el hilo del suelo: píxeles RGBA (sin premultiplicar) al lienzo id, si sigue siendo el mismo (gen).
void
canvas_put_rgba(int id, unsigned gen, const Uint8 *px, int w, int h) {
  pthread_mutex_lock(&surf_mx);
  if(id > 0 && id < n_surfs && surfs[id].s && surfs[id].gen == gen) {
    surf_t *s = &surfs[id];
    int W = plutovg_surface_get_width(s->s), Hh = plutovg_surface_get_height(s->s), stride = plutovg_surface_get_stride(s->s) / 4;
    Uint32 *dp = (Uint32*)plutovg_surface_get_data(s->s);
    if(w > W) w = W;
    if(h > Hh) h = Hh;
    for(int y = 0; y < h; y++)
      for(int x = 0; x < w; x++) {
        const Uint8 *p = px + ((size_t)y * w + x) * 4;
        unsigned a = p[3];
        dp[(size_t)y * stride + x] = a << 24 | (p[0] * a / 255) << 16 | (p[1] * a / 255) << 8 | (p[2] * a / 255);
      }
    s->painted = 1;
    s->dirty = 1;
  }
  pthread_mutex_unlock(&surf_mx);
}

// Los píxeles de un lienzo (ARGB premultiplicado) para main.c (la capa de avisos del cooperativo local), o NULL.
const Uint32*
canvas_pixels(int id, int *w, int *h, int *stride) {
  if(id <= 0 || id >= n_surfs || !surfs[id].s) return NULL;
  *w = plutovg_surface_get_width(surfs[id].s); *h = plutovg_surface_get_height(surfs[id].s);
  *stride = plutovg_surface_get_stride(surfs[id].s) / 4;
  return (const Uint32*)plutovg_surface_get_data(surfs[id].s);
}

// ---------------- la pantalla por GPU (gpu.c) ----------------
// Con gpu_on, la pantalla la pinta la GPU. Los atajos (blit, solid_rect, blit_plain: sprites, suelo, partículas,
// textos y degradados ya pintados) le mandan un cuadrilátero; lo demás (caminos, texto nuevo, recortes, otros modos)
// lo pinta PlutoVG como siempre en el búfer de la pantalla, que queda de borrador: transparente salvo durante una
// llamada. Cada llamada marca lo que pinta (touch) y dispatch sube ese recuadro (gpu_scratch) y lo vuelve a borrar.
static int scr = -1;            // el id de la pantalla
static int tx0, ty0, tx1, ty1;  // lo pintado en el borrador en esta llamada (vacío si tx1 <= tx0)
static int tcut;                // y si el borde de la pantalla lo cortó (entonces no se guarda en path_cached)
static int op_force = -1;       // el modo de mezcla de esta llamada (clearRect, putImageData); si no, el del estado
static unsigned long scr_n, scr_px;   // subidas del borrador y sus píxeles (para [dibujo])
// Diagnóstico (18-11-2026): por qué sube cada borrador (en la tablet de anfitrión, 24 por fotograma y 1,6 Mpx: ~9 ms).
// «alfa»: la misma figura y color ya estaba en la caché con otra transparencia (algo que se desvanece).
// ponytail: quitarlo cuando se sepa qué arreglar.
// fillRect/strokeRect, por qué no fueron por la GPU (rect_why): degradado sin caché, recorte por la CPU, otro modo de
// mezcla, con giro, o (strokeRect) con guiones.
enum { W_FILL_NEW, W_FILL_ALPHA, W_FILL_NC, W_STROKE_NEW, W_STROKE_ALPHA, W_STROKE_NC,
       W_FRECT, W_FRECT_GRAD = W_FRECT, W_FRECT_CLIP, W_FRECT_OP, W_FRECT_ROT, W_FRECT_DASH,
       W_SRECT, W_SRECT_GRAD = W_SRECT, W_SRECT_CLIP, W_SRECT_OP, W_SRECT_ROT, W_SRECT_DASH,
       W_TEXT, W_IMG, W_OTHER, W_N };
static const char *const WHY[W_N] = { "relleno nuevo", "relleno alfa", "relleno sin caché", "trazo nuevo", "trazo alfa",
                                      "trazo sin caché",
                                      "fillRect degradado", "fillRect recorte", "fillRect modo", "fillRect giro", "fillRect ?",
                                      "strokeRect degradado", "strokeRect recorte", "strokeRect modo", "strokeRect giro",
                                      "strokeRect guiones", "texto", "imagen", "otro" };
static int scr_why = -1;
static unsigned long why_n[W_N], why_px[W_N];
static int trace_left;                // PS_GPU_TRACE=n: las n primeras subidas, una línea cada una (stderr)

static int
on_gpu(const surf_t *s) { return gpu_on && scr >= 0 && s == &surfs[scr]; }

// El modo con el que PlutoVG pinta: en el borrador, siempre encima (la GPU mezcla luego con el de verdad).
static int
op_of(surf_t *s) { return on_gpu(s) ? 0 : cur(s)->op; }

static void
touch(const surf_t *s, plutovg_rect_t r, float pad) {
  int W, H, x0, y0, x1, y1;
  if(!on_gpu(s) || r.w < 0 || r.h < 0) return;
  W = plutovg_surface_get_width(s->s); H = plutovg_surface_get_height(s->s);
  x0 = (int)floorf(r.x - pad) - 1; y0 = (int)floorf(r.y - pad) - 1;
  x1 = (int)ceilf(r.x + r.w + pad) + 1; y1 = (int)ceilf(r.y + r.h + pad) + 1;
  if(x0 < 0 || y0 < 0 || x1 > W || y1 > H) tcut = 1;
  if(x0 < 0) x0 = 0;
  if(y0 < 0) y0 = 0;
  if(x1 > W) x1 = W;
  if(y1 > H) y1 = H;
  if(x1 <= x0 || y1 <= y0) return;
  if(tx1 <= tx0) { tx0 = x0; ty0 = y0; tx1 = x1; ty1 = y1; return; }
  if(x0 < tx0) tx0 = x0;
  if(y0 < ty0) ty0 = y0;
  if(x1 > tx1) tx1 = x1;
  if(y1 > ty1) ty1 = y1;
}

// Las 4 esquinas de un rectángulo (x, y, w, h) llevado por m, para gpu_quad, y su recuadro.
static plutovg_rect_t
corners(const mat_t *m, double x, double y, double w, double h, float *xy) {
  float mx0, my0, mx1, my1;
  apply(m, x, y, &xy[0], &xy[1]); apply(m, x + w, y, &xy[2], &xy[3]);
  apply(m, x + w, y + h, &xy[4], &xy[5]); apply(m, x, y + h, &xy[6], &xy[7]);
  mx0 = mx1 = xy[0]; my0 = my1 = xy[1];
  for(int i = 2; i < 8; i += 2) {
    mx0 = fminf(mx0, xy[i]); mx1 = fmaxf(mx1, xy[i]); my0 = fminf(my0, xy[i + 1]); my1 = fmaxf(my1, xy[i + 1]);
  }
  return (plutovg_rect_t){ mx0, my0, mx1 - mx0, my1 - my0 };
}

// La textura de un lienzo, subida si ha cambiado.
static unsigned
tex_of(surf_t *s) {
  if(!s->tex || s->dirty) {
    s->dirty = 0;
    s->tex = gpu_upload(s->tex, (const Uint32*)plutovg_surface_get_data(s->s), plutovg_surface_get_width(s->s),
                        plutovg_surface_get_height(s->s), plutovg_surface_get_stride(s->s) / 4);
  }
  return s->tex;
}

int
canvas_screen(Uint32 *pixels, int w, int h) {
  return scr = add_surface(plutovg_surface_create_for_data((unsigned char*)pixels, w, h, w * 4));
}

// Para ps.shot (main.c): read = 1 trae la pantalla de la GPU al búfer; read = 0 lo deja otra vez de borrador.
void
canvas_screen_sync(int read) {
  int w, h;
  if(!gpu_on || scr < 0) return;
  w = plutovg_surface_get_width(surfs[scr].s); h = plutovg_surface_get_height(surfs[scr].s);
  if(read) gpu_read((Uint32*)plutovg_surface_get_data(surfs[scr].s), w, h);
  else memset(plutovg_surface_get_data(surfs[scr].s), 0, (size_t)w * h * 4);
}

// El color o degradado del estado, con la opacidad global, listo para rellenar o trazar.
static void
set_paint(surf_t *s, int stroke) {
  cstate_t *st = cur(s);
  plutovg_paint_t *g = stroke ? st->stroke_grad : st->fill_grad;
  plutovg_canvas_set_operator(s->c, OPS[op_of(s)]);
  plutovg_canvas_set_opacity(s->c, st->alpha);
  if(g) {
    plutovg_canvas_set_paint(s->c, g);
  } else {
    plutovg_canvas_set_color(s->c, stroke ? &st->stroke : &st->fill);
  }
}

static void
identity(surf_t *s) { plutovg_canvas_reset_matrix(s->c); }

// ---------------- superficies ----------------

static JSValue
cv_new(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int w = (int)num(ctx, argv[0]), h = (int)num(ctx, argv[1]);
  return JS_NewInt32(ctx, add_surface(plutovg_surface_create(w > 0 ? w : 1, h > 0 ? h : 1)));
}

// Bytes de píxeles de todos los lienzos vivos: los tirados por el juego sólo se sueltan cuando pasa el
// recolector del JS, que no los ve (browser.js lo lanza también cuando esto crece).
static JSValue
cv_bytes(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  double n = 0;
  pthread_mutex_lock(&surf_mx);
  for(int i = 0; i < n_surfs; i++)
    if(surfs[i].s) n += (double)plutovg_surface_get_stride(surfs[i].s) * plutovg_surface_get_height(surfs[i].s);
  pthread_mutex_unlock(&surf_mx);
  return JS_NewFloat64(ctx, n);
}

// Cambiar el tamaño de un lienzo lo borra y reinicia su estado, como en el navegador.
static JSValue
cv_resize(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  int w = (int)num(ctx, argv[1]), h = (int)num(ctx, argv[2]);
  if(!s || w <= 0 || h <= 0) return JS_UNDEFINED;
  if(plutovg_surface_get_width(s->s) != w || plutovg_surface_get_height(s->s) != h) {
    plutovg_canvas_destroy(s->c);
    plutovg_surface_destroy(s->s);
    s->s = plutovg_surface_create(w, h);
    s->c = plutovg_canvas_create(s->s);
  } else {
    memset(plutovg_surface_get_data(s->s), 0, (size_t)plutovg_surface_get_stride(s->s) * h);
  }
  s->sp = 0;
  reset_state(&s->st[0]);
  return JS_UNDEFINED;
}

static JSValue
cv_load(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *path = JS_ToCString(ctx, argv[0]);
  char ov[800];
  int id = path ? add_surface(plutovg_surface_load_from_image_file(upd_path(path, ov, sizeof ov))) : -1;
  canvas_loads++;
  JSValue r = id < 0 ? JS_ThrowReferenceError(ctx, "no se pudo cargar %s", path ? path : "?") : JS_NewInt32(ctx, id);
  JS_FreeCString(ctx, path);
  return r;
}

// Cargar imágenes en otros hilos (cv_load_async / cv_load_poll, browser.js): leer y descomprimir un PNG en el hilo del
// juego eran 12-13 ms por fotograma al volver al menú y 3-5 ms con enemigos nuevos en partida. Aquí lo hacen LOADERS hilos
// (add_surface ya va con candado) y el juego sólo recoge el número de cada lienzo.
#define LOADERS 2
typedef struct lj { struct lj *next; int req, id; char *path; void *owner; } lj_t;   // owner: el contexto JS que la pidió
static lj_t *lq_head, *lq_tail, *ld_head, *ld_tail;   // por cargar / cargadas
static pthread_mutex_t lq_mx = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t lq_cv = PTHREAD_COND_INITIALIZER;
static int lq_next = 1;

static void*
loader(void *arg) {
  (void)arg;
  for(;;) {
    pthread_mutex_lock(&lq_mx);
    while(!lq_head) pthread_cond_wait(&lq_cv, &lq_mx);
    lj_t *j = lq_head;
    lq_head = j->next;
    if(!lq_head) lq_tail = NULL;
    pthread_mutex_unlock(&lq_mx);
    j->id = add_surface(plutovg_surface_load_from_image_file(j->path));
    free(j->path); j->path = NULL; j->next = NULL;
    pthread_mutex_lock(&lq_mx);
    if(ld_tail) ld_tail->next = j; else ld_head = j;
    ld_tail = j;
    pthread_mutex_unlock(&lq_mx);
  }
  return NULL;
}

// cv_load_async(ruta) -> número de petición (> 0), o -1 si no hay hilos (entonces, cv_load).
static JSValue
cv_load_async(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  static int started;
  if(!started) { pthread_t t; for(int i = 0; i < LOADERS; i++) started += !pthread_create(&t, NULL, loader, NULL); }
  const char *path = started ? JS_ToCString(ctx, argv[0]) : NULL;
  lj_t *j = path ? calloc(1, sizeof *j) : NULL;
  char ov[800];
  if(j && !(j->path = strdup(upd_path(path, ov, sizeof ov)))) { free(j); j = NULL; }
  if(j) j->owner = ctx;
  JS_FreeCString(ctx, path);
  if(!j) return JS_NewInt32(ctx, -1);
  pthread_mutex_lock(&lq_mx);
  int req = j->req = lq_next++;
  if(lq_tail) lq_tail->next = j; else lq_head = j;
  lq_tail = j;
  pthread_cond_signal(&lq_cv);
  pthread_mutex_unlock(&lq_mx);
  return JS_NewInt32(ctx, req);
}

// cv_load_poll() -> [[petición, lienzo o -1], …]: las ya cargadas desde la última vez.
static JSValue
cv_load_poll(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  // Sólo las de este contexto (con jugador 2 hay dos juegos pidiendo imágenes); las demás se quedan en la cola.
  lj_t *l = NULL, **lt = &l, *keep = NULL, *klast = NULL;
  pthread_mutex_lock(&lq_mx);
  for(lj_t *j = ld_head, *n; j; j = n) {
    n = j->next; j->next = NULL;
    if(j->owner == ctx) { *lt = j; lt = &j->next; }
    else { if(klast) klast->next = j; else keep = j; klast = j; }
  }
  ld_head = keep; ld_tail = klast;
  pthread_mutex_unlock(&lq_mx);
  JSValue a = JS_NewArray(ctx);
  for(uint32_t i = 0; l; i++) {
    lj_t *n = l->next;
    JSValue e = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, e, 0, JS_NewInt32(ctx, l->req));
    JS_SetPropertyUint32(ctx, e, 1, JS_NewInt32(ctx, l->id));
    JS_SetPropertyUint32(ctx, a, i, e);
    canvas_loads++;
    free(l);
    l = n;
  }
  return a;
}

// cv_painted(id): ¿ya lo pintó el hilo del suelo? (boot.js: la pantalla de carga espera al suelo que se ve al empezar)
static JSValue
cv_painted(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  return JS_NewBool(ctx, s && s->painted);
}

// cv_hold(id) -> asa: cuando el JS la suelta (el lienzo o la imagen ya no se usa), el lienzo se libera.
static JSValue
cv_hold(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int id = (int)num(ctx, argv[0]);
  JSValue h = JS_NewObjectClass(ctx, hold_class);
  JS_SetOpaque(h, (void*)(intptr_t)(id + 1));
  return h;
}

// cv_release(asa): suelta el lienzo ya, sin esperar al recolector (que no ve sus píxeles): browser.js, img.src = ''.
static JSValue
cv_release(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int id = (int)(intptr_t)JS_GetOpaque(argv[0], hold_class) - 1;
  if(id > 0) { JS_SetOpaque(argv[0], NULL); free_surface(id); }   // (y el finalizador ya no hace nada)
  return JS_UNDEFINED;
}

static JSValue
cv_size(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  JSValue a = JS_NewArray(ctx);
  JS_SetPropertyUint32(ctx, a, 0, JS_NewInt32(ctx, s ? plutovg_surface_get_width(s->s) : 0));
  JS_SetPropertyUint32(ctx, a, 1, JS_NewInt32(ctx, s ? plutovg_surface_get_height(s->s) : 0));
  return a;
}

// ---------------- estado y transformaciones ----------------

static JSValue
cv_save(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  if(!s || s->sp + 1 >= MAX_DEPTH) return JS_UNDEFINED;
  s->st[s->sp + 1] = s->st[s->sp];
  if(cur(s)->fill_grad) plutovg_paint_reference(cur(s)->fill_grad);
  if(cur(s)->stroke_grad) plutovg_paint_reference(cur(s)->stroke_grad);
  s->sp++;
  plutovg_canvas_save(s->c);   // por el recorte
  return JS_UNDEFINED;
}

static JSValue
cv_restore(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  if(!s || !s->sp) return JS_UNDEFINED;
  plutovg_paint_destroy(cur(s)->fill_grad);
  plutovg_paint_destroy(cur(s)->stroke_grad);
  const int gclip = cur(s)->gclip;
  s->sp--;
  if(gclip && !cur(s)->gclip) gpu_clip_off();
  plutovg_canvas_restore(s->c);
  return JS_UNDEFINED;
}

static JSValue
cv_setTransform(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  if(s) cur(s)->m = (mat_t){ num(ctx, argv[1]), num(ctx, argv[2]), num(ctx, argv[3]),
                             num(ctx, argv[4]), num(ctx, argv[5]), num(ctx, argv[6]) };
  return JS_UNDEFINED;
}

static JSValue
cv_transform(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  if(s) mul(&cur(s)->m, num(ctx, argv[1]), num(ctx, argv[2]), num(ctx, argv[3]),
            num(ctx, argv[4]), num(ctx, argv[5]), num(ctx, argv[6]));
  return JS_UNDEFINED;
}

static JSValue
cv_translate(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  if(s) mul(&cur(s)->m, 1, 0, 0, 1, num(ctx, argv[1]), num(ctx, argv[2]));
  return JS_UNDEFINED;
}

static JSValue
cv_scale(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  if(s) mul(&cur(s)->m, num(ctx, argv[1]), 0, 0, num(ctx, argv[2]), 0, 0);
  return JS_UNDEFINED;
}

static JSValue
cv_rotate(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  double a = num(ctx, argv[1]);
  if(s) mul(&cur(s)->m, cos(a), sin(a), -sin(a), cos(a), 0, 0);
  return JS_UNDEFINED;
}

// cv_set(id, campo, valor): las propiedades numéricas del contexto.
enum { P_ALPHA, P_OP, P_LINE_WIDTH, P_LINE_CAP, P_LINE_JOIN, P_ALIGN, P_BASELINE };

static JSValue
cv_set(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  int field = (int)num(ctx, argv[1]);
  double v = num(ctx, argv[2]);
  cstate_t *st;
  if(!s) return JS_UNDEFINED;
  st = cur(s);
  switch(field) {
  case P_ALPHA: st->alpha = v < 0 ? 0 : v > 1 ? 1 : v; break;
  case P_OP: if(v >= 0 && v < sizeof OPS / sizeof *OPS) st->op = (int)v; break;
  case P_LINE_WIDTH: if(v > 0) st->line_width = v; break;
  case P_LINE_CAP: plutovg_canvas_set_line_cap(s->c, (plutovg_line_cap_t)v); break;
  case P_LINE_JOIN: plutovg_canvas_set_line_join(s->c, (plutovg_line_join_t)v); break;
  case P_ALIGN: st->align = (int)v; break;          // 0 left/start · 1 center · 2 right/end
  case P_BASELINE: st->baseline = (int)v; break;    // 0 alphabetic · 1 top · 2 middle · 3 bottom
  }
  return JS_UNDEFINED;
}

// cv_color(id, trazo?, "css") -> true si se entendió el color
static JSValue
cv_color(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  int stroke = JS_ToBool(ctx, argv[1]);
  const char *css = JS_ToCString(ctx, argv[2]);
  plutovg_color_t c;
  int ok = s && css && plutovg_color_parse(&c, css, -1) > 0;
  if(ok) {
    cstate_t *st = cur(s);
    plutovg_paint_t **g = stroke ? &st->stroke_grad : &st->fill_grad;
    plutovg_paint_destroy(*g);
    *g = NULL;
    *(stroke ? &st->stroke : &st->fill) = c;
  }
  JS_FreeCString(ctx, css);
  return JS_NewBool(ctx, ok);
}

// cv_gradient(id, trazo?, radial?, x0, y0, r0, x1, y1, r1, [offset, "css", offset, "css", ...])
static JSValue
cv_gradient(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  int stroke = JS_ToBool(ctx, argv[1]), radial = JS_ToBool(ctx, argv[2]);
  plutovg_gradient_stop_t stops[32];
  int n = 0;
  JSValue len;
  Uint32 count = 0;
  cstate_t *st;
  plutovg_paint_t *p, **g;
  plutovg_matrix_t m;
  if(!s) return JS_UNDEFINED;
  // La matriz del momento va en el propio degradado: los trazados ya están en pantalla.
  m = pm(&cur(s)->m);
  len = JS_GetPropertyStr(ctx, argv[9], "length");
  JS_ToUint32(ctx, &count, len);
  JS_FreeValue(ctx, len);
  for(Uint32 i = 0; i + 1 < count && n < 32; i += 2) {
    JSValue o = JS_GetPropertyUint32(ctx, argv[9], i), c = JS_GetPropertyUint32(ctx, argv[9], i + 1);
    const char *css = JS_ToCString(ctx, c);
    stops[n].offset = num(ctx, o);
    if(css && plutovg_color_parse(&stops[n].color, css, -1) > 0) n++;
    JS_FreeCString(ctx, css);
    JS_FreeValue(ctx, o);
    JS_FreeValue(ctx, c);
  }
  if(radial)   // canvas: círculo inicial (x0, y0, r0) → final (x1, y1, r1); PlutoVG: centro y foco
    p = plutovg_paint_create_radial_gradient(num(ctx, argv[6]), num(ctx, argv[7]), num(ctx, argv[8]),
                                             num(ctx, argv[3]), num(ctx, argv[4]), num(ctx, argv[5]),
                                             PLUTOVG_SPREAD_METHOD_PAD, stops, n, &m);
  else
    p = plutovg_paint_create_linear_gradient(num(ctx, argv[3]), num(ctx, argv[4]), num(ctx, argv[6]), num(ctx, argv[7]),
                                             PLUTOVG_SPREAD_METHOD_PAD, stops, n, &m);
  st = cur(s);
  g = stroke ? &st->stroke_grad : &st->fill_grad;
  plutovg_paint_destroy(*g);
  *g = p;
  {   // huella: tipo, coordenadas, matriz y paradas (FNV-1a de 64 bits)
    unsigned long long h = 1469598103934665603ull;
    float f[13] = { (float)radial, (float)num(ctx, argv[3]), (float)num(ctx, argv[4]), (float)num(ctx, argv[5]), (float)num(ctx, argv[6]),
                    (float)num(ctx, argv[7]), (float)num(ctx, argv[8]), m.a, m.b, m.c, m.d, m.e, m.f };
    const unsigned char *b = (const unsigned char*)f;
    for(size_t i = 0; i < sizeof f; i++) h = (h ^ b[i]) * 1099511628211ull;
    b = (const unsigned char*)stops;
    for(size_t i = 0; i < n * sizeof *stops; i++) h = (h ^ b[i]) * 1099511628211ull;
    *(stroke ? &st->stroke_gkey : &st->fill_gkey) = h | 1;
  }
  return JS_UNDEFINED;
}

static JSValue
cv_dash(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  float dashes[16];
  Uint32 count = 0;
  JSValue len;
  if(!s) return JS_UNDEFINED;
  len = JS_GetPropertyStr(ctx, argv[1], "length");
  JS_ToUint32(ctx, &count, len);
  JS_FreeValue(ctx, len);
  if(count > 16) count = 16;
  for(Uint32 i = 0; i < count; i++) {
    JSValue v = JS_GetPropertyUint32(ctx, argv[1], i);
    dashes[i] = num(ctx, v);
    JS_FreeValue(ctx, v);
  }
  plutovg_canvas_set_dash(s->c, argc > 2 ? num(ctx, argv[2]) : 0, dashes, count);
  return JS_UNDEFINED;
}

// ---------------- trazados (en coordenadas de pantalla) ----------------

// La huella del trazado (path_cached): cada punto, relativo al primero y en octavos de píxel, así que no cambia al
// moverse la cámara o la figura.
static void
hpt(surf_t *s, int kind, float x, float y) {
  long long qx, qy;
  if(!on_gpu(s)) return;
  if(!s->pn++) { s->pox = x; s->poy = y; }
  qx = llroundf((x - s->pox) * 8); qy = llroundf((y - s->poy) * 8);
  s->ph = (s->ph ^ (unsigned)kind) * 1099511628211ull;
  s->ph = (s->ph ^ (unsigned long long)qx) * 1099511628211ull;
  s->ph = (s->ph ^ (unsigned long long)qy) * 1099511628211ull;
}

static void
move(surf_t *s, double x, double y) {
  float px, py;
  apply(&cur(s)->m, x, y, &px, &py);
  hpt(s, 2, px, py);
  plutovg_canvas_move_to(s->c, px, py);
  s->has_point = 1;
}

static void
line(surf_t *s, double x, double y) {
  float px, py;
  if(!s->has_point) { move(s, x, y); return; }
  apply(&cur(s)->m, x, y, &px, &py);
  hpt(s, 3, px, py);
  plutovg_canvas_line_to(s->c, px, py);
}

// Arco de elipse con giro, en segmentos rectos (los puntos ya transformados: vale para cualquier matriz).
static void
ellipse(surf_t *s, double cx, double cy, double rx, double ry, double rot, double a0, double a1, int ccw) {
  const mat_t *m = &cur(s)->m;
  double sweep, scale = sqrt(fabs(m->a * m->d - m->b * m->c)), cr = cos(rot), sr = sin(rot);
  int n;
  if(rx < 0 || ry < 0) return;
  sweep = a1 - a0;
  if(!ccw && sweep < 0) sweep = fmod(sweep, 2 * M_PI) + 2 * M_PI;
  if(ccw && sweep > 0) sweep = fmod(sweep, 2 * M_PI) - 2 * M_PI;
  if(fabs(a1 - a0) >= 2 * M_PI) sweep = ccw ? -2 * M_PI : 2 * M_PI;
  // Un segmento cada ~2 px de arco en pantalla, entre 6 y 96.
  n = (int)(fabs(sweep) * (rx > ry ? rx : ry) * scale / 2);
  n = n < 6 ? 6 : n > 96 ? 96 : n;
  for(int i = 0; i <= n; i++) {
    double a = a0 + sweep * i / n, ex = rx * cos(a), ey = ry * sin(a);
    line(s, cx + ex * cr - ey * sr, cy + ex * sr + ey * cr);
  }
}

// Un trazado de sólo rectángulos en la pantalla por GPU (los rayos: fillRects de fx.js, ~100 rect() girados por capa):
// sus esquinas ya en pantalla, para que fill_path mande un cuadrilátero por rectángulo en vez de rasterizar el trazado
// en la CPU y subir el borrador (5 rayos a la vez: de 120 a menos de 30 fps en una tablet).
// ponytail: con transparencia, donde dos rectángulos se pisan se mezcla dos veces (el trazado entero, una); en los rayos
// sólo se pisan en los bordes del zigzag y durante el desvanecido.
static float *rq;
static int rqn, rqcap, rq_ok;

static void
rq_add(surf_t *s, double x, double y, double w, double h) {
  const mat_t *m = &cur(s)->m;
  if(!rq_ok) return;
  if(rqn + 8 > rqcap) {
    float *n = realloc(rq, (size_t)(rqcap ? rqcap * 2 : 1024) * sizeof *rq);
    if(!n) { rq_ok = 0; return; }
    rq = n; rqcap = rqcap ? rqcap * 2 : 1024;
  }
  apply(m, x, y, &rq[rqn], &rq[rqn + 1]); apply(m, x + w, y, &rq[rqn + 2], &rq[rqn + 3]);
  apply(m, x + w, y + h, &rq[rqn + 4], &rq[rqn + 5]); apply(m, x, y + h, &rq[rqn + 6], &rq[rqn + 7]);
  rqn += 8;
}

static JSValue
cv_path(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  // cv_path(id, orden, ...): 0 beginPath · 1 closePath · 2 moveTo · 3 lineTo · 4 quadraticCurveTo
  // 5 bezierCurveTo · 6 arc · 7 ellipse · 8 rect
  surf_t *s = surf(ctx, argv[0]);
  double a[8] = { 0 };
  float p[6];
  if(!s) return JS_UNDEFINED;
  for(int i = 0; i < 8 && i + 2 < argc; i++) a[i] = num(ctx, argv[i + 2]);
  const int op = (int)num(ctx, argv[1]);
  if(on_gpu(s)) { if(op == 0) { rqn = 0; rq_ok = 1; } else if(op == 8) rq_add(s, a[0], a[1], a[2], a[3]); else rq_ok = 0; }
  switch(op) {
  case 0: plutovg_canvas_new_path(s->c); s->has_point = 0; s->ph = 14695981039346656037ull; s->pn = 0; break;
  case 1: plutovg_canvas_close_path(s->c); hpt(s, 1, s->pox, s->poy); break;
  case 2: move(s, a[0], a[1]); break;
  case 3: line(s, a[0], a[1]); break;
  case 4:
    if(!s->has_point) move(s, a[0], a[1]);
    apply(&cur(s)->m, a[0], a[1], &p[0], &p[1]);
    apply(&cur(s)->m, a[2], a[3], &p[2], &p[3]);
    for(int i = 0; i < 4; i += 2) hpt(s, 4, p[i], p[i + 1]);
    plutovg_canvas_quad_to(s->c, p[0], p[1], p[2], p[3]);
    break;
  case 5:
    if(!s->has_point) move(s, a[0], a[1]);
    apply(&cur(s)->m, a[0], a[1], &p[0], &p[1]);
    apply(&cur(s)->m, a[2], a[3], &p[2], &p[3]);
    apply(&cur(s)->m, a[4], a[5], &p[4], &p[5]);
    for(int i = 0; i < 6; i += 2) hpt(s, 5, p[i], p[i + 1]);
    plutovg_canvas_cubic_to(s->c, p[0], p[1], p[2], p[3], p[4], p[5]);
    break;
  case 6: ellipse(s, a[0], a[1], a[2], a[2], 0, a[3], a[4], argc > 7 && JS_ToBool(ctx, argv[7])); break;
  case 7: ellipse(s, a[0], a[1], a[2], a[3], a[4], a[5], a[6], argc > 9 && JS_ToBool(ctx, argv[9])); break;
  case 8:
    move(s, a[0], a[1]); line(s, a[0] + a[2], a[1]); line(s, a[0] + a[2], a[1] + a[3]); line(s, a[0], a[1] + a[3]);
    plutovg_canvas_close_path(s->c);
    move(s, a[0], a[1]);
    break;
  }
  return JS_UNDEFINED;
}

// ---------------- rellenos ya pintados (pantalla por GPU) ----------------
// Las sombras de cada Pokémon, las barras redondeadas del HUD…: la misma figura en cada fotograma, en otro sitio.
// La primera vez va por el borrador y se guarda lo pintado; luego es una textura (gpu_image) al píxel más cercano
// (hasta ½ px de diferencia: pixel art). Sólo color liso y sin recorte. La transparencia global no cuenta: se guarda
// opaco y la GPU la aplica al dibujarlo (el escudo de los enemigos oscila y era una figura nueva en cada fotograma).
// ponytail: tabla de acceso directo por la huella de 64 bits (sin comparar la figura entera; un choque = otra figura).
#define PC_SIZE 1024
static struct { unsigned long long key; plutovg_surface_t *img; float ox, oy; } pc[PC_SIZE];
static int pc_slot = -1;           // un fallo en esta llamada: dispatch guarda lo pintado en pc[pc_slot]
static float pc_ga = 1;            // (y la transparencia global: se guarda opaco y la GPU la pone al dibujarlo)
static unsigned long long pc_key;
static unsigned long long pc_na[PC_SIZE];   // (diagnóstico) las mismas huellas sin la transparencia
static int pc_alpha;                        // (diagnóstico) este fallo sólo cambia la transparencia

// stroke: lw = el grosor en pantalla (trazos sin guiones); si no, un relleno con evenodd.
static int
path_cached(surf_t *s, int stroke, int evenodd, float lw) {
  const cstate_t *st = cur(s);
  const plutovg_color_t *c = stroke ? &st->stroke : &st->fill;
  unsigned long long k;
  int i;
  if(!on_gpu(s) || !s->pn || st->clipped || (stroke ? st->stroke_grad : st->fill_grad) || st->alpha <= 0) return 0;
  if(stroke && plutovg_canvas_get_dash_array(s->c, NULL) > 0) return 0;
  k = s->ph ^ ((unsigned long long)(c->r * 255 + 0.5) << 8 | (unsigned long long)(c->g * 255 + 0.5) << 16 |
               (unsigned long long)(c->b * 255 + 0.5) << 24 | (unsigned long long)(c->a * 255 + 0.5) << 32 |
               (unsigned long long)evenodd << 48 |
               (unsigned long long)stroke << 49);
  if(stroke) k = (k ^ ((unsigned long long)(lw * 8 + 0.5) | (unsigned long long)plutovg_canvas_get_line_cap(s->c) << 20 |
                       (unsigned long long)plutovg_canvas_get_line_join(s->c) << 24)) * 1099511628211ull;
  i = (int)(k % PC_SIZE);
  if(pc[i].img && pc[i].key == k) {
    plutovg_surface_t *img = pc[i].img;
    const int w = plutovg_surface_get_width(img), h = plutovg_surface_get_height(img);
    const float x = floorf(s->pox + pc[i].ox + 0.5f), y = floorf(s->poy + pc[i].oy + 0.5f);
    const float xy[8] = { x, y, x + w, y, x + w, y + h, x, y + h };
    gpu_quad(gpu_image(img, (const Uint32*)plutovg_surface_get_data(img), w, h, plutovg_surface_get_stride(img) / 4),
             w, h, st->op, xy, 0, 0, w, h, st->alpha, st->alpha, st->alpha, st->alpha);
    return 1;
  }
  pc_slot = i; pc_key = k;
  {   // (diagnóstico) ¿la misma figura, de otra transparencia?
    unsigned long long na = s->ph ^ ((unsigned long long)(c->r * 255 + 0.5) << 8 | (unsigned long long)(c->g * 255 + 0.5) << 16 |
                                     (unsigned long long)(c->b * 255 + 0.5) << 24 | (unsigned long long)evenodd << 48 |
                                     (unsigned long long)stroke << 49 | (unsigned long long)(lw * 8 + 0.5) << 52);
    pc_alpha = pc_na[na % PC_SIZE] == na;
    pc_na[na % PC_SIZE] = na;
  }
  return 0;
}

// Un fallo que se va a guardar (path_cached, sin cortar por el borde): se pinta opaco y dispatch lo dibuja con pc_ga.
static void
pc_opaque(surf_t *s) {
  if(pc_slot < 0 || tcut || cur(s)->alpha >= 1) return;
  pc_ga = cur(s)->alpha;
  plutovg_canvas_set_opacity(s->c, 1);
}

static void
fill_path(surf_t *s, int evenodd) {
  const cstate_t *st = cur(s);
  if(on_gpu(s) && rq_ok && rqn && !st->fill_grad && !st->clipped && st->op == 0) {   // sólo rectángulos: a la GPU (rq_add)
    const float k = st->alpha * st->fill.a;
    if(k > 0) for(int i = 0; i < rqn; i += 8) gpu_quad(0, 1, 1, 0, &rq[i], 0, 0, 1, 1, st->fill.r * k, st->fill.g * k, st->fill.b * k, k);
    return;
  }
  if(path_cached(s, 0, evenodd, 0)) return;
  scr_why = pc_slot < 0 ? W_FILL_NC : pc_alpha ? W_FILL_ALPHA : W_FILL_NEW;
  set_paint(s, 0);
  plutovg_canvas_set_fill_rule(s->c, evenodd ? PLUTOVG_FILL_RULE_EVEN_ODD : PLUTOVG_FILL_RULE_NON_ZERO);
  if(on_gpu(s)) { plutovg_rect_t r; plutovg_canvas_fill_extents(s->c, &r); touch(s, r, 0); }
  pc_opaque(s);
  plutovg_canvas_fill_preserve(s->c);
  identity(s);
}

static void
stroke_path(surf_t *s) {
  const mat_t *m = &cur(s)->m;
  const float lw = cur(s)->line_width * sqrt(fabs(m->a * m->d - m->b * m->c));
  if(path_cached(s, 1, 0, lw)) return;
  scr_why = pc_slot < 0 ? W_STROKE_NC : pc_alpha ? W_STROKE_ALPHA : W_STROKE_NEW;
  set_paint(s, 1);
  // El trazado ya está en pantalla: el grosor se escala aquí (aproximado si hay giro o escala desigual).
  plutovg_canvas_set_line_width(s->c, lw);
  if(on_gpu(s)) { plutovg_rect_t r; plutovg_canvas_stroke_extents(s->c, &r); touch(s, r, 0); }
  pc_opaque(s);
  plutovg_canvas_stroke_preserve(s->c);
  identity(s);
}

// Un rectángulo en un trazado aparte: fillRect y compañía no tocan el trazado actual.
static int grad_cached(surf_t *s, double x, double y, double w, double h);
static int solid_rect(surf_t *s, double x, double y, double w, double h);

static plutovg_path_t*
rect_path(surf_t *s, double x, double y, double w, double h) {
  float px, py;
  if(!s->rp) s->rp = plutovg_path_create();
  plutovg_path_t *p = s->rp;
  plutovg_path_reset(p);
  apply(&cur(s)->m, x, y, &px, &py); plutovg_path_move_to(p, px, py);
  apply(&cur(s)->m, x + w, y, &px, &py); plutovg_path_line_to(p, px, py);
  apply(&cur(s)->m, x + w, y + h, &px, &py); plutovg_path_line_to(p, px, py);
  apply(&cur(s)->m, x, y + h, &px, &py); plutovg_path_line_to(p, px, py);
  plutovg_path_close(p);
  return p;
}

// El recorte de la pantalla por GPU (ctx.clip): el trazado actual, aplanado, al stencil (gpu_clip). Sus puntos ya van en
// píxeles de pantalla (move/line los transforman). Uno a la vez: uno dentro de otro va por PlutoVG (clipped).
#define CLIP_PTS 4096
static float clip_xy[CLIP_PTS * 2];
static int clip_n[256], clip_np, clip_pts;
static void
clip_pt(void *closure, plutovg_path_command_t cmd, const plutovg_point_t *pt, int n) {
  (void)closure;
  if(cmd == PLUTOVG_PATH_COMMAND_CLOSE || !n) return;
  if(cmd == PLUTOVG_PATH_COMMAND_MOVE_TO) { if(clip_np >= 256) return; clip_n[clip_np++] = 0; }
  if(!clip_np || clip_pts >= CLIP_PTS) return;
  clip_xy[clip_pts * 2] = pt[n - 1].x; clip_xy[clip_pts * 2 + 1] = pt[n - 1].y;
  clip_pts++; clip_n[clip_np - 1]++;
}
static int
gpu_clip_path(surf_t *s) {
  if(!on_gpu(s) || cur(s)->clipped || cur(s)->gclip) return 0;
  clip_np = clip_pts = 0;
  plutovg_path_traverse_flatten(plutovg_canvas_get_path(s->c), clip_pt, NULL);
  if(clip_pts >= CLIP_PTS || clip_np >= 256) return 0;   // ponytail: un recorte enorme, por la CPU como antes
  gpu_clip(clip_xy, clip_n, clip_np);
  cur(s)->gclip = 1;
  return 1;
}

// Por qué un fillRect (base W_FRECT) o strokeRect (W_SRECT) no fue por el atajo de la GPU.
static int
rect_why(surf_t *s, int base, int stroke) {
  const cstate_t *st = cur(s);
  if(st->clipped) return base + 1;
  if(st->op != 0) return base + 2;
  if(st->m.b != 0 || st->m.c != 0 || st->m.a <= 0 || st->m.d <= 0) return base + 3;
  if(stroke && plutovg_canvas_get_dash_array(s->c, NULL) > 0) return base + 4;
  return base;   // (el degradado, o sin huella)
}

// Un rectángulo liso con la matriz entera (giro, escala) y el modo de mezcla: un cuadrilátero en la GPU, sin suavizar
// el borde (como los sprites girados). Los avisos de rayo (hazards.js) iban girados por la CPU: 13-27 MB/s.
static void
gpu_rect(surf_t *s, const plutovg_color_t *c, double x, double y, double w, double h) {
  const cstate_t *st = cur(s);
  const float k = st->alpha * c->a;
  float xy[8];
  if((k <= 0 && st->op == 0) || w == 0 || h == 0) return;   // (transparente sólo no pinta en el modo normal: «copy» borra)
  corners(&st->m, x, y, w, h, xy);
  gpu_quad(0, 1, 1, st->op, xy, 0, 0, 1, 1, c->r * k, c->g * k, c->b * k, k);
}

// Un trozo de borde de strokeRect (a lo largo de su lado: x, y = inicio, dx, dy = dirección, de t a t + n), lw de ancho.
static void
edge(surf_t *s, double x, double y, int dx, int dy, double t, double n, double lw) {
  const double hl = lw / 2;
  if(dx) gpu_rect(s, &cur(s)->stroke, dx > 0 ? x + t : x - t - n, y - hl, n, lw);
  else gpu_rect(s, &cur(s)->stroke, x - hl, dy > 0 ? y + t : y - t - n, lw, n);
}

// strokeRect en la pantalla por GPU, sin recorte ni degradado: sin pintar por la CPU ni subir el recuadro entero (en la
// tablet de anfitrión, cientos de kpx por fotograma). Recto, en el modo normal y sin guiones: 4 rectángulos al píxel
// (solid_rect, igual que PlutoVG); si no (giro, otro modo, guiones): cuadriláteros (gpu_rect), uno por guion.
// ponytail: con guiones, las esquinas no se unen (falta el cuadradito del inglete donde dos guiones se tocan).
static int
stroke_rect(surf_t *s, double x, double y, double w, double h) {
  cstate_t *st = cur(s);
  const double lw = st->line_width, hl = lw / 2;
  const float *da = NULL;
  const int nd = plutovg_canvas_get_dash_array(s->c, &da);
  if(!on_gpu(s) || st->stroke_grad || st->clipped || lw <= 0) return 0;
  if(w < 0) { x += w; w = -w; }
  if(h < 0) { y += h; h = -h; }
  if(nd <= 0 && st->op == 0 && st->m.b == 0 && st->m.c == 0 && st->m.a > 0 && st->m.d > 0) {
    plutovg_color_t f = st->fill;
    plutovg_paint_t *fg = st->fill_grad;
    int ok = 1;
    st->fill = st->stroke; st->fill_grad = NULL;   // (solid_rect pinta con el color de relleno)
    if(w <= lw || h <= lw) ok = solid_rect(s, x - hl, y - hl, w + lw, h + lw);   // sin hueco: el recuadro de fuera
    else if((ok = solid_rect(s, x - hl, y - hl, w + lw, lw))) {   // arriba (con las esquinas), abajo, izquierda, derecha
      solid_rect(s, x - hl, y + h - hl, w + lw, lw);
      solid_rect(s, x - hl, y + hl, lw, h - lw);
      solid_rect(s, x + w - hl, y + hl, lw, h - lw);
    }
    st->fill = f; st->fill_grad = fg;
    return ok;
  }
  if(nd <= 0) {
    if(w <= lw || h <= lw) { gpu_rect(s, &st->stroke, x - hl, y - hl, w + lw, h + lw); return 1; }
    gpu_rect(s, &st->stroke, x - hl, y - hl, w + lw, lw);
    gpu_rect(s, &st->stroke, x - hl, y + h - hl, w + lw, lw);
    gpu_rect(s, &st->stroke, x - hl, y + hl, lw, h - lw);
    gpu_rect(s, &st->stroke, x + w - hl, y + hl, lw, h - lw);
    return 1;
  }
  {   // Guiones: se recorre el borde desde (x, y) como el navegador (arriba, derecha, abajo, izquierda).
    const int n = nd % 2 ? nd * 2 : nd;   // (impar: el patrón dos veces)
    const double sx[4] = { x, x + w, x + w, x }, sy[4] = { y, y, y + h, y + h }, len[4] = { w, h, w, h };
    const int ddx[4] = { 1, 0, -1, 0 }, ddy[4] = { 0, 1, 0, -1 };
    double total = 0, ph, rem;
    int i = 0;
    for(int j = 0; j < n; j++) total += da[j % nd];
    if(!(total > 0) || 2 * (w + h) / total > 2048) return 0;   // (sin patrón, o miles de guiones: por la CPU)
    ph = fmod(plutovg_canvas_get_dash_offset(s->c), total);
    if(ph < 0) ph += total;
    while(ph >= da[i % nd]) { ph -= da[i % nd]; i = (i + 1) % n; }
    rem = da[i % nd] - ph;
    for(int e = 0; e < 4; e++)
      for(double t = 0; t < len[e];) {
        const double step = fmin(rem, len[e] - t);
        if(!(i % 2) && step > 0) edge(s, sx[e], sy[e], ddx[e], ddy[e], t, step, lw);
        t += step; rem -= step;
        if(rem <= 1e-9) { i = (i + 1) % n; rem = da[i % nd]; }
      }
    return 1;
  }
}

// cv_paint(id, orden, ...): 0 fill(evenodd?) · 1 stroke · 2 clip · 3 fillRect · 4 strokeRect · 5 clearRect
static JSValue
cv_paint(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  int what = (int)num(ctx, argv[1]);
  plutovg_path_t *r = NULL;
  if(!s) return JS_UNDEFINED;
  if(what >= 3) r = rect_path(s, num(ctx, argv[2]), num(ctx, argv[3]), num(ctx, argv[4]), num(ctx, argv[5]));
  switch(what) {
  case 0: fill_path(s, argc > 2 && JS_ToBool(ctx, argv[2])); break;
  case 1: stroke_path(s); break;
  case 2: if(!gpu_clip_path(s)) { plutovg_canvas_clip_preserve(s->c); cur(s)->clipped = 1; } break;
  case 3:
    if(solid_rect(s, num(ctx, argv[2]), num(ctx, argv[3]), num(ctx, argv[4]), num(ctx, argv[5]))) break;
    if(grad_cached(s, num(ctx, argv[2]), num(ctx, argv[3]), num(ctx, argv[4]), num(ctx, argv[5]))) break;
    if(on_gpu(s) && !cur(s)->clipped && !cur(s)->fill_grad) {   // con giro u otro modo: un cuadrilátero (gpu_rect)
      gpu_rect(s, &cur(s)->fill, num(ctx, argv[2]), num(ctx, argv[3]), num(ctx, argv[4]), num(ctx, argv[5]));
      break;
    }
    scr_why = rect_why(s, W_FRECT, 0);
    set_paint(s, 0);
    plutovg_canvas_set_fill_rule(s->c, PLUTOVG_FILL_RULE_NON_ZERO);
    if(on_gpu(s)) { plutovg_rect_t e; plutovg_path_extents(r, &e, false); touch(s, e, 0); }
    plutovg_canvas_fill_path(s->c, r);
    identity(s);
    break;
  case 4: {
    const mat_t *m = &cur(s)->m;
    const float lw = cur(s)->line_width * sqrt(fabs(m->a * m->d - m->b * m->c));
    if(stroke_rect(s, num(ctx, argv[2]), num(ctx, argv[3]), num(ctx, argv[4]), num(ctx, argv[5]))) break;
    scr_why = rect_why(s, W_SRECT, 1);
    set_paint(s, 1);
    plutovg_canvas_set_line_width(s->c, lw);
    if(on_gpu(s)) { plutovg_rect_t e; plutovg_path_extents(r, &e, false); touch(s, e, lw / 2); }
    plutovg_canvas_stroke_path(s->c, r);
    identity(s);
    break;
  }
  case 5:
    // (en la GPU: el recuadro del borrador, a cero, con «clear»)
    if(on_gpu(s) && !cur(s)->clipped) {   // un cuadrilátero con «clear», sin subir nada
      float xy[8];
      corners(&cur(s)->m, num(ctx, argv[2]), num(ctx, argv[3]), num(ctx, argv[4]), num(ctx, argv[5]), xy);
      gpu_quad(0, 1, 1, 10, xy, 0, 0, 1, 1, 0, 0, 0, 0);
      break;
    }
    if(on_gpu(s)) { plutovg_rect_t e; plutovg_path_extents(r, &e, false); touch(s, e, 0); op_force = 10; break; }
    plutovg_canvas_set_operator(s->c, PLUTOVG_OPERATOR_CLEAR);
    plutovg_canvas_fill_path(s->c, r);
    break;
  }
  return JS_UNDEFINED;
}

// fillRect con degradado (la viñeta de la pantalla, la niebla, la Sentencia): PlutoVG calcula el degradado píxel a
// píxel, y a pantalla completa eran ~4 ms por fotograma. Se pinta una vez en una imagen y luego sólo se copia
// (blit_plain, que se salta los píxeles transparentes). Sin recorte, giro ni otro modo de mezcla: como siempre.
#define GC_SIZE 8
static struct { unsigned long long key; int x, y, w, h; plutovg_surface_t *img; } gcache[GC_SIZE];
static int gc_next;

static void blit_plain(surf_t *dst, plutovg_surface_t *img, int x0, int y0, unsigned ga);

static int
grad_cached(surf_t *s, double x, double y, double w, double h) {
  cstate_t *st = cur(s);
  const mat_t *m = &st->m;
  int W = plutovg_surface_get_width(s->s), H = plutovg_surface_get_height(s->s), x0, y0, x1, y1, i;
  unsigned ga;
  if(!st->fill_grad || !st->fill_gkey || st->clipped || st->op != 0 || m->b != 0 || m->c != 0 || m->a <= 0 || m->d <= 0) return 0;
  if(w < 0) { x += w; w = -w; }
  if(h < 0) { y += h; h = -h; }
  x0 = (int)floor(m->a * x + m->e + 0.5); y0 = (int)floor(m->d * y + m->f + 0.5);
  x1 = (int)floor(m->a * (x + w) + m->e + 0.5); y1 = (int)floor(m->d * (y + h) + m->f + 0.5);
  if(x0 < 0) x0 = 0;
  if(y0 < 0) y0 = 0;
  if(x1 > W) x1 = W;
  if(y1 > H) y1 = H;
  if(x1 <= x0 || y1 <= y0) return 1;
  ga = st->alpha >= 1 ? 256 : (unsigned)(st->alpha * 256);
  if(!ga) return 1;
  for(i = 0; i < GC_SIZE; i++)
    if(gcache[i].img && gcache[i].key == st->fill_gkey && gcache[i].x == x0 && gcache[i].y == y0 && gcache[i].w == x1 - x0 && gcache[i].h == y1 - y0) break;
  if(i == GC_SIZE) {
    static plutovg_path_t *p;
    plutovg_surface_t *img = plutovg_surface_create(x1 - x0, y1 - y0);
    plutovg_canvas_t *c;
    if(!img) return 0;
    if(!p) p = plutovg_path_create();
    plutovg_path_reset(p);
    plutovg_path_add_rect(p, x0, y0, x1 - x0, y1 - y0);
    c = plutovg_canvas_create(img);
    plutovg_canvas_translate(c, -x0, -y0);
    plutovg_canvas_set_paint(c, st->fill_grad);
    plutovg_canvas_fill_path(c, p);
    plutovg_canvas_destroy(c);
    i = gc_next; gc_next = (gc_next + 1) % GC_SIZE;
    if(gcache[i].img) { gpu_forget(gcache[i].img); plutovg_surface_destroy(gcache[i].img); }
    gcache[i].key = st->fill_gkey; gcache[i].x = x0; gcache[i].y = y0; gcache[i].w = x1 - x0; gcache[i].h = y1 - y0; gcache[i].img = img;
  }
  blit_plain(s, gcache[i].img, x0, y0, ga);
  return 1;
}

// fillRect de un color, sin giro ni recorte y en el modo normal: los píxeles a mano. Son las partículas de los
// efectos (FX: miles de cuadraditos de 1-4 px al final de la partida) y PlutoVG montaba su rasterizador con
// suavizado para cada uno: ~4 µs, unos 8 ms por fotograma. Bordes al píxel más cercano (pixel art); si el
// rectángulo es más fino que un píxel, ese píxel con la transparencia que le toca.
static Uint32 over(Uint32 d, Uint32 s, unsigned ga);

static int
solid_rect(surf_t *s, double x, double y, double w, double h) {
  cstate_t *st = cur(s);
  const mat_t *m = &st->m;
  int W = plutovg_surface_get_width(s->s), H = plutovg_surface_get_height(s->s), stride, x0, y0, x1, y1;
  double fx0, fy0, fx1, fy1, cov = 1;
  unsigned ga, a;
  Uint32 c, *dp;
  if(st->fill_grad || st->clipped || st->op != 0 || m->b != 0 || m->c != 0 || m->a <= 0 || m->d <= 0) return 0;
  if(w < 0) { x += w; w = -w; }
  if(h < 0) { y += h; h = -h; }
  fx0 = m->a * x + m->e; fx1 = fx0 + m->a * w; fy0 = m->d * y + m->f; fy1 = fy0 + m->d * h;
  x0 = (int)floor(fx0 + 0.5); x1 = (int)floor(fx1 + 0.5); y0 = (int)floor(fy0 + 0.5); y1 = (int)floor(fy1 + 0.5);
  if(x1 == x0) { if(fx1 - fx0 <= 0) return 1; x1 = x0 + 1; cov *= fx1 - fx0; }
  if(y1 == y0) { if(fy1 - fy0 <= 0) return 1; y1 = y0 + 1; cov *= fy1 - fy0; }
  if(x0 < 0) x0 = 0;
  if(y0 < 0) y0 = 0;
  if(x1 > W) x1 = W;
  if(y1 > H) y1 = H;
  if(x1 <= x0 || y1 <= y0) return 1;
  a = (unsigned)(st->fill.a * 255 + 0.5);
  if(!a) return 1;
  // Color premultiplicado (como guarda PlutoVG la superficie) y la transparencia global en ga.
  c = a << 24 | (unsigned)(st->fill.r * a + 0.5) << 16 | (unsigned)(st->fill.g * a + 0.5) << 8 | (unsigned)(st->fill.b * a + 0.5);
  ga = (unsigned)(st->alpha * cov * 256 + 0.5);
  if(ga > 256) ga = 256;
  if(!ga) return 1;
  if(on_gpu(s)) {
    const float k = ga / 256.f * a / 255.f;
    const float xy[8] = { x0, y0, x1, y0, x1, y1, x0, y1 };
    gpu_quad(0, 1, 1, 0, xy, 0, 0, 1, 1, st->fill.r * k, st->fill.g * k, st->fill.b * k, k);
    return 1;
  }
  stride = plutovg_surface_get_stride(s->s) / 4;
  dp = (Uint32*)plutovg_surface_get_data(s->s);
  for(int yy = y0; yy < y1; yy++) {
    Uint32 *d = dp + (size_t)yy * stride;
    if(a == 255 && ga == 256) for(int xx = x0; xx < x1; xx++) d[xx] = c;
    else for(int xx = x0; xx < x1; xx++) d[xx] = over(d[xx], c, ga);
  }
  return 1;
}

// ---------------- texto ----------------

void
canvas_set_font_dir(const char *dir) {
  snprintf(font_dir, sizeof font_dir, "%s", dir);
}

static plutovg_font_face_t*
face(int bold) {
  if(!faces[bold]) {
    char path[600];
    snprintf(path, sizeof path, "%s/PixelifyPS-%s.ttf", font_dir, bold ? "700" : "400");
    char ov[800];
    faces[bold] = plutovg_font_face_load_from_file(upd_path(path, ov, sizeof ov), 0);
    if(!faces[bold] && bold) faces[bold] = face(0);
  }
  return faces[bold];
}

static JSValue
cv_font(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  if(s) { cur(s)->font_size = num(ctx, argv[1]); cur(s)->bold = JS_ToBool(ctx, argv[2]); }
  return JS_UNDEFINED;
}

// Siguiente carácter UTF-8 (sin validar: el texto viene de QuickJS, que da UTF-8 correcto).
static unsigned
utf8(const char **p, const char *end) {
  const unsigned char *s = (const unsigned char*)*p;
  unsigned c = *s++;
  int n = c >= 0xf0 ? 3 : c >= 0xe0 ? 2 : c >= 0xc0 ? 1 : 0;
  c &= n == 3 ? 0x07 : n == 2 ? 0x0f : n == 1 ? 0x1f : 0x7f;
  while(n-- && (const char*)s < end) c = c << 6 | (*s++ & 0x3f);
  *p = (const char*)s;
  return c;
}

// Símbolos que el juego usa y la fuente Pixelify no tiene (salían como rectángulos): se dibujan aquí, a la
// medida de la letra (s = tamaño), sobre la línea base en x. Devuelve el avance; 0 si no es uno de éstos.
static void
ring(plutovg_path_t *p, float cx, float cy, float r, float ri) {   // aro: el hueco va al revés (non-zero)
  plutovg_path_move_to(p, cx + r, cy); plutovg_path_add_arc(p, cx, cy, r, 0, 2 * M_PI, false); plutovg_path_close(p);
  plutovg_path_move_to(p, cx + ri, cy); plutovg_path_add_arc(p, cx, cy, ri, 0, -2 * M_PI, true); plutovg_path_close(p);
}
static void
poly(plutovg_path_t *p, const float *xy, int n, float x, float s) {
  plutovg_path_move_to(p, x + xy[0] * s, xy[1] * s);
  for(int i = 1; i < n; i++) plutovg_path_line_to(p, x + xy[2 * i] * s, xy[2 * i + 1] * s);
  plutovg_path_close(p);
}
static float
symbol(plutovg_path_t *p, unsigned c, float s, float x) {
  static const float RIGHT[] = { .08f,-.38f, .5f,-.38f, .5f,-.55f, .85f,-.32f, .5f,-.09f, .5f,-.26f, .08f,-.26f };
  static const float LEFT[]  = { .82f,-.38f, .4f,-.38f, .4f,-.55f, .05f,-.32f, .4f,-.09f, .4f,-.26f, .82f,-.26f };
  static const float UP[]    = { .24f,-.02f, .24f,-.45f, .07f,-.45f, .3f,-.75f, .53f,-.45f, .36f,-.45f, .36f,-.02f };
  static const float DOWN[]  = { .24f,-.75f, .24f,-.32f, .07f,-.32f, .3f,-.02f, .53f,-.32f, .36f,-.32f, .36f,-.75f };
  float adv = 0;
  switch(c) {
  case 0x2192: adv = .9f; if(p) poly(p, RIGHT, 7, x, s); break;   // →
  case 0x2190: adv = .9f; if(p) poly(p, LEFT, 7, x, s); break;    // ←
  case 0x2191: adv = .6f; if(p) poly(p, UP, 7, x, s); break;      // ↑
  case 0x2193: adv = .6f; if(p) poly(p, DOWN, 7, x, s); break;    // ↓
  case 0x2605: case 0x2606:                                       // ★ ☆
    adv = .9f;
    if(p) {
      float cx = x + .45f * s, cy = -.36f * s;
      for(int k = 0; k < 10; k++) {
        float a = -M_PI / 2 + k * M_PI / 5, r = (k & 1 ? .16f : .38f) * s;
        if(k) plutovg_path_line_to(p, cx + cosf(a) * r, cy + sinf(a) * r); else plutovg_path_move_to(p, cx + cosf(a) * r, cy + sinf(a) * r);
      }
      plutovg_path_close(p);
    }
    break;
  case 0x2640:                                                    // ♀
    adv = .7f;
    if(p) {
      ring(p, x + .35f * s, -.55f * s, .22f * s, .12f * s);
      plutovg_path_add_rect(p, x + .3f * s, -.34f * s, .1f * s, .36f * s);
      plutovg_path_add_rect(p, x + .18f * s, -.2f * s, .34f * s, .09f * s);
    }
    break;
  case 0x2715: {                           // ✕ (botón cruz)
    static const float A[] = { .12f,-.62f, .22f,-.72f, .72f,-.22f, .62f,-.12f };
    static const float B[] = { .62f,-.72f, .72f,-.62f, .22f,-.12f, .12f,-.22f };
    adv = .84f;
    if(p) { poly(p, A, 4, x, s); poly(p, B, 4, x, s); }
    break;
  }
  case 0x25cb:                                                    // ○ (botón círculo)
    adv = .84f;
    if(p) ring(p, x + .42f * s, -.42f * s, .32f * s, .21f * s);
    break;
  case 0x25a1: {                                                  // □ (botón cuadrado)
    static const float O[] = { .12f,-.72f, .72f,-.72f, .72f,-.12f, .12f,-.12f };
    static const float I[] = { .22f,-.22f, .62f,-.22f, .62f,-.62f, .22f,-.62f };   // al revés: hueco
    adv = .84f;
    if(p) { poly(p, O, 4, x, s); poly(p, I, 4, x, s); }
    break;
  }
  case 0x25b3: {                                                  // △ (botón triángulo)
    static const float O[] = { .42f,-.78f, .78f,-.12f, .06f,-.12f };
    static const float I[] = { .42f,-.56f, .22f,-.22f, .62f,-.22f };               // al revés: hueco
    adv = .84f;
    if(p) { poly(p, O, 3, x, s); poly(p, I, 3, x, s); }
    break;
  }
  case 0x2642: {                                                  // ♂
    static const float SHAFT[] = { .45f,-.5f, .6f,-.65f, .67f,-.58f, .52f,-.43f };
    static const float HEAD[]  = { .5f,-.76f, .78f,-.76f, .78f,-.48f };
    adv = .82f;
    if(p) { ring(p, x + .33f * s, -.3f * s, .22f * s, .12f * s); poly(p, SHAFT, 4, x, s); poly(p, HEAD, 3, x, s); }
    break;
  }
  }
  return adv * s;
}

// El texto como trazado aparte (en coordenadas del texto); devuelve el ancho. path NULL: sólo mide.
static float
text_path(surf_t *s, const char *t, size_t len, plutovg_path_t *path) {
  plutovg_font_face_t *f = face(cur(s)->bold);
  const char *end = t + len;
  float x = 0;
  if(!f) return 0;
  while(t < end) {
    unsigned c = utf8(&t, end);
    float sym = symbol(path, c, cur(s)->font_size, x);
    if(sym > 0) { x += sym; continue; }
    if(path) x += plutovg_font_face_get_glyph_path(f, cur(s)->font_size, x, 0, c, path);
    else {   // sólo medir (get_glyph_path con NULL revienta: añadiría los puntos a un trazado nulo)
      float adv = 0;
      plutovg_font_face_get_glyph_metrics(f, cur(s)->font_size, c, &adv, NULL, NULL);
      x += adv;
    }
  }
  return x;
}

static float
text_width(surf_t *s, const char *t, size_t len) { return text_path(s, t, len, NULL); }

static int text_cached(surf_t *s, const char *t, size_t len, int stroke, double x, double y, float k);

// cv_text(id, trazo?, texto, x, y, anchoMáximo|undefined)
static JSValue
cv_text(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  int stroke = JS_ToBool(ctx, argv[1]);
  size_t len;
  const char *t = JS_ToCStringLen(ctx, &len, argv[2]);
  double x = num(ctx, argv[3]), y = num(ctx, argv[4]), max = argc > 5 && !JS_IsUndefined(argv[5]) ? num(ctx, argv[5]) : 0;
  cstate_t *st;
  plutovg_font_face_t *f;
  float width, ascent, descent, k = 1;
  mat_t m;
  plutovg_matrix_t pmx;
  if(!s || !t || !(f = face(cur(s)->bold))) { JS_FreeCString(ctx, t); return JS_UNDEFINED; }
  st = cur(s);
  width = text_width(s, t, len);
  if(max > 0 && width > max) k = max / width;
  plutovg_font_face_get_metrics(f, st->font_size, &ascent, &descent, NULL, NULL);   // descent < 0
  if(st->align == 1) x -= width * k / 2;
  else if(st->align == 2) x -= width * k;
  // top / middle / bottom van por el cuadro em, como en el navegador: la parte de ascent cabe en font_size
  // (ascent / (ascent - descent)). Con el ascent tal cual (Pixelify: 920 + 280 sobre 1000) el texto quedaba un
  // 15 % del tamaño más bajo que en la web y descuadrado con los iconos.
  {
    float em_asc = ascent - descent > 0 ? st->font_size * ascent / (ascent - descent) : ascent;
    if(st->baseline == 1) y += em_asc;
    else if(st->baseline == 2) y += em_asc - st->font_size / 2;
    else if(st->baseline == 3) y += em_asc - st->font_size;
  }
  if(text_cached(s, t, len, stroke, x, y, k)) { JS_FreeCString(ctx, t); return JS_UNDEFINED; }
  {
    // El texto va en su propio trazado (el actual no se toca), llevado a pantalla con su matriz.
    static plutovg_path_t *path;
    if(!path) path = plutovg_path_create();
    plutovg_path_reset(path);
    text_path(s, t, len, path);
    m = st->m;
    mul(&m, k, 0, 0, 1, x, y);
    pmx = pm(&m);
    plutovg_path_transform(path, &pmx);
    set_paint(s, stroke);
    if(on_gpu(s)) { plutovg_rect_t e; plutovg_path_extents(path, &e, false); touch(s, e, stroke ? st->line_width * 2 : 0); }
    if(stroke) {
      plutovg_canvas_set_line_width(s->c, st->line_width * sqrt(fabs(m.a * m.d - m.b * m.c)));
      plutovg_canvas_stroke_path(s->c, path);
    } else {
      plutovg_canvas_set_fill_rule(s->c, PLUTOVG_FILL_RULE_NON_ZERO);
      plutovg_canvas_fill_path(s->c, path);
    }
    identity(s);
  }
  JS_FreeCString(ctx, t);
  return JS_UNDEFINED;
}

static JSValue
cv_measure(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  size_t len;
  const char *t = JS_ToCStringLen(ctx, &len, argv[1]);
  double w = s && t ? text_width(s, t, len) : 0;
  JS_FreeCString(ctx, t);
  return JS_NewFloat64(ctx, w);
}

// ---------------- imágenes ----------------

// Fuente sobre destino en ARGB premultiplicado, con opacidad extra ga (0..256).
static inline Uint32
over(Uint32 d, Uint32 s, unsigned ga) {
  unsigned a;
  if(ga < 256) {
    s = ((((s & 0xff00ff) * ga) >> 8) & 0xff00ff) | ((((s >> 8) & 0xff00ff) * ga) & 0xff00ff00);
  }
  a = 255 - (s >> 24);
  if(!a) return s;
  return s + (((((d & 0xff00ff) * a) >> 8) & 0xff00ff) | ((((d >> 8) & 0xff00ff) * a) & 0xff00ff00));
}

// El atajo: sin giro ni recorte, al píxel más cercano (pixel art). tint: la silueta en blanco (el destello).
static void
blit(surf_t *dst, surf_t *src, double sx, double sy, double sw, double sh,
     double dx, double dy, double dw, double dh, int tint) {
  const cstate_t *st = cur(dst);
  const mat_t *m = &st->m;
  int W = plutovg_surface_get_width(dst->s), H = plutovg_surface_get_height(dst->s);
  int SW = plutovg_surface_get_width(src->s), SH = plutovg_surface_get_height(src->s);
  int dstride = plutovg_surface_get_stride(dst->s) / 4, sstride = plutovg_surface_get_stride(src->s) / 4;
  Uint32 *dp = (Uint32*)plutovg_surface_get_data(dst->s);
  const Uint32 *sp = (const Uint32*)plutovg_surface_get_data(src->s);
  double X0 = m->a * dx + m->e, X1 = m->a * (dx + dw) + m->e, Y0 = m->d * dy + m->f, Y1 = m->d * (dy + dh) + m->f;
  int flipx = X1 < X0, flipy = Y1 < Y0, ix0, iy0, ix1, iy1, smaxx, smaxy;
  unsigned ga = st->alpha >= 1 ? 256 : (unsigned)(st->alpha * 256);
  double ku, kv;
  if(on_gpu(dst)) {   // (las mismas esquinas: la GPU también pinta los píxeles cuyo centro cae dentro y muestrea al píxel)
    const float k = ga / 256.f, xy[8] = { X0, Y0, X1, Y0, X1, Y1, X0, Y1 };
    if(src != dst && ga) gpu_quad(tex_of(src), SW, SH, 0, xy, sx, sy, sw, sh, tint ? -k : k, k, k, k);
    return;
  }
  if(flipx) { double t = X0; X0 = X1; X1 = t; }
  if(flipy) { double t = Y0; Y0 = Y1; Y1 = t; }
  if(X1 - X0 <= 0 || Y1 - Y0 <= 0 || !ga) return;
  ix0 = (int)ceil(X0 - 0.5); ix1 = (int)ceil(X1 - 0.5);
  iy0 = (int)ceil(Y0 - 0.5); iy1 = (int)ceil(Y1 - 0.5);
  if(ix0 < 0) ix0 = 0;
  if(iy0 < 0) iy0 = 0;
  if(ix1 > W) ix1 = W;
  if(iy1 > H) iy1 = H;
  smaxx = (int)ceil(sx + sw) - 1; smaxy = (int)ceil(sy + sh) - 1;
  if(smaxx >= SW) smaxx = SW - 1;
  if(smaxy >= SH) smaxy = SH - 1;
  ku = sw / (X1 - X0); kv = sh / (Y1 - Y0);
  for(int y = iy0; y < iy1; y++) {
    double fy = (y + 0.5 - Y0) * kv;
    int row = (int)(flipy ? sy + sh - fy : sy + fy);
    Uint32 *d = dp + (size_t)y * dstride;
    const Uint32 *srow;
    Sint64 u, du;
    if(row < 0 || row > smaxy) continue;
    srow = sp + (size_t)row * sstride;
    // Coma fija 16.16 a lo largo de la fila.
    u = (Sint64)(((flipx ? sx + sw - (ix0 + 0.5 - X0) * ku : sx + (ix0 + 0.5 - X0) * ku)) * 65536);
    du = (Sint64)(ku * 65536) * (flipx ? -1 : 1);
    for(int x = ix0; x < ix1; x++, u += du) {
      int col = (int)(u >> 16);
      Uint32 s;
      if(col < 0 || col > smaxx) continue;
      s = srow[col];
      if(!(s >> 24) && ga) continue;
      if(tint) s = (s >> 24) * 0x01010101u;   // blanco premultiplicado con su transparencia
      d[x] = (s >> 24) == 255 && ga == 256 ? s : over(d[x], s, ga);
    }
  }
}

// ---------------- texto ya pintado ----------------
// Pintar texto es caro: cada letra es un trazado que se rellena (o se perfila, peor aún). El HUD pinta
// decenas de textos en cada fotograma y se llevaba 18 ms. Cada texto (con su letra, tamaño, color, trazo
// y escala) se pinta una vez en una superficie pequeña y luego sólo se copia, al píxel entero más cercano.
// Sólo sin giro, sin recorte, con color liso y "source-over"; lo demás, por el camino normal.
// ponytail: tabla de acceso directo (choca = se reemplaza), sin LRU; basta para HUD y menús.
#define TC_SIZE 2048
typedef struct {
  char *t; size_t len;
  float size, sx, sy, lw; plutovg_color_t col; int bold, stroke;
  plutovg_surface_t *img; int ox, oy;
} tc_t;
static tc_t tc[TC_SIZE];

static void
blit_plain(surf_t *dst, plutovg_surface_t *img, int x0, int y0, unsigned ga) {
  int W = plutovg_surface_get_width(dst->s), H = plutovg_surface_get_height(dst->s);
  int w = plutovg_surface_get_width(img), h = plutovg_surface_get_height(img);
  int dstride = plutovg_surface_get_stride(dst->s) / 4, sstride = plutovg_surface_get_stride(img) / 4;
  Uint32 *dp = (Uint32*)plutovg_surface_get_data(dst->s);
  const Uint32 *sp = (const Uint32*)plutovg_surface_get_data(img);
  int ax = x0 < 0 ? -x0 : 0, ay = y0 < 0 ? -y0 : 0, bx = x0 + w > W ? W - x0 : w, by = y0 + h > H ? H - y0 : h;
  if(on_gpu(dst)) {
    const float k = ga / 256.f, xy[8] = { x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h };
    gpu_quad(gpu_image(img, sp, w, h, sstride), w, h, 0, xy, 0, 0, w, h, k, k, k, k);
    return;
  }
  for(int y = ay; y < by; y++) {
    Uint32 *d = dp + (size_t)(y0 + y) * dstride + x0;
    const Uint32 *r = sp + (size_t)y * sstride;
    for(int x = ax; x < bx; x++) {
      Uint32 c = r[x];
      if(!(c >> 24)) continue;
      d[x] = (c >> 24) == 255 && ga == 256 ? c : over(d[x], c, ga);
    }
  }
}

static int
text_cached(surf_t *s, const char *t, size_t len, int stroke, double x, double y, float k) {
  cstate_t *st = cur(s);
  const mat_t *m = &st->m;
  plutovg_color_t col = stroke ? st->stroke : st->fill;
  float sx = m->a * k, sy = m->d, lw = stroke ? st->line_width * sqrt(fabs(m->a * m->d)) : 0;
  unsigned h = 2166136261u, ga;
  tc_t *e;
  // Recortado (clip) en un lienzo de la CPU: también de la caché, pintado por PlutoVG (que respeta el recorte). Sin esto, el
  // texto de las listas que se desplazan (ui.js las pinta dentro de un clip) rehacía el trazado de cada letra en cada paso:
  // 13 ms por redibujo en la tienda en Android. En la pantalla por GPU, un recorte de PlutoVG sigue por el camino largo.
  if(m->b != 0 || m->c != 0 || m->a <= 0 || m->d <= 0 || (st->clipped && on_gpu(s)) || st->op != 0 || (stroke ? st->stroke_grad : st->fill_grad)) return 0;
  ga = st->alpha >= 1 ? 256 : (unsigned)(st->alpha * 256);
  if(!ga) return 1;
  for(size_t i = 0; i < len; i++) h = (h ^ (unsigned char)t[i]) * 16777619u;
  h ^= (unsigned)(st->font_size * 64) * 31u + (unsigned)(sx * 1024) * 17u + (unsigned)(sy * 1024) * 13u + (unsigned)(lw * 64) * 7u
       + (unsigned)(col.r * 255) * 3u + (unsigned)(col.g * 255) * 5u + (unsigned)(col.b * 255) * 11u + (unsigned)(col.a * 255) * 19u
       + (unsigned)st->bold * 23u + (unsigned)stroke * 29u;
  e = &tc[h % TC_SIZE];
  if(!(e->img && e->len == len && e->size == st->font_size && e->sx == sx && e->sy == sy && e->lw == lw && e->bold == st->bold
       && e->stroke == stroke && !memcmp(&e->col, &col, sizeof col) && !memcmp(e->t, t, len))) {
    static plutovg_path_t *path;
    plutovg_matrix_t tm;
    plutovg_rect_t r;
    plutovg_surface_t *img;
    plutovg_canvas_t *c;
    int pad, w, hh, ox, oy;
    char *copy = malloc(len + 1);
    if(!copy) return 0;
    if(!path) path = plutovg_path_create();
    plutovg_path_reset(path);
    text_path(s, t, len, path);
    plutovg_matrix_init_scale(&tm, sx, sy);
    plutovg_path_transform(path, &tm);
    plutovg_path_extents(path, &r, false);
    pad = (int)ceil(lw / 2) + 2;
    ox = (int)floor(r.x) - pad; oy = (int)floor(r.y) - pad;
    w = (int)ceil(r.x + r.w) + pad - ox; hh = (int)ceil(r.y + r.h) + pad - oy;
    if(w <= 0 || hh <= 0 || w > 4096 || hh > 1024) { free(copy); return len == 0; }
    if(!(img = plutovg_surface_create(w, hh))) { free(copy); return 0; }
    c = plutovg_canvas_create(img);
    plutovg_canvas_translate(c, -ox, -oy);
    plutovg_canvas_set_color(c, &col);
    if(stroke) { plutovg_canvas_set_line_width(c, lw); plutovg_canvas_stroke_path(c, path); }
    else { plutovg_canvas_set_fill_rule(c, PLUTOVG_FILL_RULE_NON_ZERO); plutovg_canvas_fill_path(c, path); }
    plutovg_canvas_destroy(c);
    if(e->img) { gpu_forget(e->img); plutovg_surface_destroy(e->img); }
    free(e->t);
    memcpy(copy, t, len); copy[len] = 0;
    *e = (tc_t){ copy, len, st->font_size, sx, sy, lw, col, st->bold, stroke, img, ox, oy };
  }
  {
    int X = (int)floor(m->a * x + m->e + 0.5) + e->ox, Y = (int)floor(m->d * y + m->f + 0.5) + e->oy;
    if(st->clipped) {
      plutovg_matrix_t tex;
      plutovg_matrix_init_translate(&tex, X, Y);
      plutovg_canvas_save(s->c);
      plutovg_canvas_reset_matrix(s->c);
      plutovg_canvas_set_operator(s->c, PLUTOVG_OPERATOR_SRC_OVER);
      plutovg_canvas_set_opacity(s->c, 1);
      plutovg_canvas_set_texture(s->c, e->img, PLUTOVG_TEXTURE_TYPE_PLAIN, ga / 256.f, &tex);
      plutovg_canvas_fill_rect(s->c, X, Y, plutovg_surface_get_width(e->img), plutovg_surface_get_height(e->img));
      plutovg_canvas_restore(s->c);
    } else blit_plain(s, e->img, X, Y, ga);
  }
  return 1;
}

// cv_draw(id, fuente, sx, sy, sw, sh, dx, dy, dw, dh)
static JSValue
cv_draw(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *dst = surf(ctx, argv[0]), *src = surf(ctx, argv[1]);
  double a[8];
  cstate_t *st;
  // 11.º argumento: la silueta en blanco (el destello de los golpes, sprites.js drawWhite), sin lienzo blanco aparte.
  // Sólo en el atajo y en la GPU; si no, false y el juego usa su copia blanca.
  const int tint = argc > 10 && JS_ToBool(ctx, argv[10]);
  if(!dst || !src || argc < 10) return JS_UNDEFINED;
  for(int i = 0; i < 8; i++) a[i] = num(ctx, argv[i + 2]);
  st = cur(dst);
  if(st->m.b == 0 && st->m.c == 0 && !st->clipped && st->op == 0) {
    blit(dst, src, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], tint);
  } else if(a[2] > 0 && a[3] > 0 && on_gpu(dst) && !st->clipped) {
    // Pantalla en la GPU, con giro u otro modo de mezcla: un cuadrilátero con la matriz entera.
    float xy[8];
    const float k = st->alpha;
    corners(&st->m, a[4], a[5], a[6], a[7], xy);
    if(src != dst && k > 0)
      gpu_quad(tex_of(src), plutovg_surface_get_width(src->s), plutovg_surface_get_height(src->s), st->op, xy,
               a[0], a[1], a[2], a[3], tint ? -k : k, k, k, k);
  } else if(tint) {
    return JS_FALSE;
  } else if(a[2] > 0 && a[3] > 0) {
    // Por PlutoVG: la imagen como textura que lleva (sx, sy, sw, sh) a (dx, dy, dw, dh).
    mat_t m = st->m;
    plutovg_matrix_t pmx, tex;
    if(on_gpu(dst)) { float xy[8]; touch(dst, corners(&st->m, a[4], a[5], a[6], a[7], xy), 0); }
    mul(&m, 1, 0, 0, 1, a[4], a[5]);
    pmx = pm(&m);
    plutovg_matrix_init(&tex, a[6] / a[2], 0, 0, a[7] / a[3], -a[0] * a[6] / a[2], -a[1] * a[7] / a[3]);
    plutovg_canvas_save(dst->c);
    plutovg_canvas_set_operator(dst->c, OPS[op_of(dst)]);
    plutovg_canvas_set_opacity(dst->c, 1);
    plutovg_canvas_set_matrix(dst->c, &pmx);
    plutovg_canvas_set_texture(dst->c, src->s, PLUTOVG_TEXTURE_TYPE_PLAIN, st->alpha, &tex);
    plutovg_canvas_fill_rect(dst->c, 0, 0, a[6], a[7]);
    plutovg_canvas_restore(dst->c);
    identity(dst);
  }
  return tint ? JS_TRUE : JS_UNDEFINED;
}

// putImageData(id, Uint8ClampedArray RGBA, w, h, dx, dy): sin mezcla y sin matriz, como en el navegador.
static JSValue
cv_putImageData(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  size_t off, len, bpe, size;
  JSValue buf = JS_GetTypedArrayBuffer(ctx, argv[1], &off, &len, &bpe);
  const Uint8 *px;
  int w = (int)num(ctx, argv[2]), h = (int)num(ctx, argv[3]), dx = (int)num(ctx, argv[4]), dy = (int)num(ctx, argv[5]);
  int W, H, stride;
  Uint32 *dp;
  if(JS_IsException(buf)) return buf;
  px = JS_GetArrayBuffer(ctx, &size, buf);
  if(!s || !px || len < (size_t)w * h * 4) { JS_FreeValue(ctx, buf); return JS_UNDEFINED; }
  px += off;
  if(on_gpu(s)) { touch(s, (plutovg_rect_t){ dx, dy, w, h }, 0); op_force = 9; }   // (sin mezcla: «copy»)
  W = plutovg_surface_get_width(s->s); H = plutovg_surface_get_height(s->s);
  stride = plutovg_surface_get_stride(s->s) / 4;
  dp = (Uint32*)plutovg_surface_get_data(s->s);
  for(int y = 0; y < h; y++) {
    if(y + dy < 0 || y + dy >= H) continue;
    for(int x = 0; x < w; x++) {
      const Uint8 *p = px + ((size_t)y * w + x) * 4;
      unsigned a = p[3];
      if(x + dx < 0 || x + dx >= W) continue;
      dp[(size_t)(y + dy) * stride + x + dx] = a << 24 | (p[0] * a / 255) << 16 | (p[1] * a / 255) << 8 | (p[2] * a / 255);
    }
  }
  JS_FreeValue(ctx, buf);
  return JS_UNDEFINED;
}

// getImageData(id, x, y, w, h) -> ArrayBuffer RGBA sin premultiplicar
static JSValue
cv_getImageData(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  surf_t *s = surf(ctx, argv[0]);
  int x0 = (int)num(ctx, argv[1]), y0 = (int)num(ctx, argv[2]), w = (int)num(ctx, argv[3]), h = (int)num(ctx, argv[4]);
  Uint8 *out;
  JSValue r;
  if(!s || w <= 0 || h <= 0) return JS_NewArrayBufferCopy(ctx, NULL, 0);
  out = calloc((size_t)w * h, 4);
  if(!out) return JS_ThrowOutOfMemory(ctx);
  {
    int W = plutovg_surface_get_width(s->s), H = plutovg_surface_get_height(s->s), stride = plutovg_surface_get_stride(s->s) / 4;
    const Uint32 *sp = (const Uint32*)plutovg_surface_get_data(s->s);
    for(int y = 0; y < h; y++)
      for(int x = 0; x < w; x++) {
        int X = x0 + x, Y = y0 + y;
        Uint32 v;
        unsigned a;
        Uint8 *p = out + ((size_t)y * w + x) * 4;
        if(X < 0 || Y < 0 || X >= W || Y >= H) continue;
        v = sp[(size_t)Y * stride + X];
        a = v >> 24;
        if(!a) continue;
        p[0] = ((v >> 16) & 255) * 255 / a; p[1] = ((v >> 8) & 255) * 255 / a; p[2] = (v & 255) * 255 / a; p[3] = a;
      }
  }
  r = JS_NewArrayBufferCopy(ctx, out, (size_t)w * h * 4);
  free(out);
  return r;
}

// Para el informe de un cierre (main.c): la última función de dibujo que se llamó y con qué lienzo.
const char *volatile canvas_last = "ninguna";
volatile int canvas_last_id = -1;
volatile unsigned long canvas_calls, canvas_loads;

typedef JSValue (*cv_fn)(JSContext*, JSValueConst, int, JSValueConst*);
static const struct { const char *name; cv_fn fn; int n; } FNS[] = {
#define F(name, n) { #name, name, n }
  F(cv_new, 2), F(cv_bytes, 0), F(cv_resize, 3), F(cv_load, 1), F(cv_load_async, 1), F(cv_load_poll, 0), F(cv_painted, 1), F(cv_size, 1), F(cv_hold, 1), F(cv_release, 1),
  F(cv_save, 1), F(cv_restore, 1),
  F(cv_setTransform, 7), F(cv_transform, 7), F(cv_translate, 3), F(cv_scale, 3), F(cv_rotate, 2),
  F(cv_set, 3), F(cv_color, 3), F(cv_gradient, 10), F(cv_dash, 3),
  F(cv_path, 10), F(cv_paint, 6),
  F(cv_font, 3), F(cv_text, 6), F(cv_measure, 2),
  F(cv_draw, 10), F(cv_putImageData, 6), F(cv_getImageData, 5),
#undef F
};

#define NFNS (int)(sizeof FNS / sizeof *FNS)
// Cuánto tarda cada función de dibujo (ciclos del procesador: leerlos cuesta casi nada) para canvas_prof.
static unsigned long long prof_cyc[NFNS], prof_n[NFNS];
#if defined(__x86_64__)
#define CYCLES() __builtin_ia32_rdtsc()
#else   // (escritorio ARM: cualquier reloj monótono vale, canvas_prof lo compara con el de verdad)
static unsigned long long CYCLES(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1000000000ull + t.tv_nsec; }
#endif


static JSValue
dispatch(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv, int magic) {
  unsigned long long t0 = CYCLES();
  JSValue r;
  canvas_last = FNS[magic].name;
  canvas_calls++;
  canvas_last_id = argc ? (int)num(ctx, argv[0]) : -1;
  if(gpu_on && scr >= 0) {
    const cv_fn fn = FNS[magic].fn;
    // Leer la pantalla (getImageData, drawImage desde ella a otro lienzo): de la GPU al borrador, y luego a cero.
    const int read = (fn == cv_getImageData && canvas_last_id == scr)
                     || (fn == cv_draw && argc > 1 && (int)num(ctx, argv[1]) == scr && canvas_last_id != scr);
    if(read) canvas_screen_sync(1);
    r = fn(ctx, this, argc, argv);
    if(read) canvas_screen_sync(0);
    if(tx1 > tx0) {   // lo que PlutoVG pintó en el borrador, a la GPU, y el borrador otra vez a cero
      surf_t *s = &surfs[scr];
      Uint32 *d = (Uint32*)plutovg_surface_get_data(s->s);
      const int stride = plutovg_surface_get_stride(s->s) / 4;
      plutovg_surface_t *img = NULL;
      if(pc_slot >= 0 && !tcut) {   // un relleno nuevo (path_cached): guardar lo pintado
        img = plutovg_surface_create(tx1 - tx0, ty1 - ty0);
        if(img) {
          Uint32 *o = (Uint32*)plutovg_surface_get_data(img);
          const int os = plutovg_surface_get_stride(img) / 4;
          for(int y = ty0; y < ty1; y++) memcpy(o + (size_t)(y - ty0) * os, d + (size_t)y * stride + tx0, (size_t)(tx1 - tx0) * 4);
          if(pc[pc_slot].img) { gpu_forget(pc[pc_slot].img); plutovg_surface_destroy(pc[pc_slot].img); }
          pc[pc_slot].img = img; pc[pc_slot].key = pc_key; pc[pc_slot].ox = tx0 - s->pox; pc[pc_slot].oy = ty0 - s->poy;
        }
      }
      if(img && pc_ga < 1) {   // (pintado opaco: pc_opaque) con su transparencia
        const float xy[8] = { tx0, ty0, tx1, ty0, tx1, ty1, tx0, ty1 };
        gpu_quad(gpu_image(img, (const Uint32*)plutovg_surface_get_data(img), tx1 - tx0, ty1 - ty0, plutovg_surface_get_stride(img) / 4),
                 tx1 - tx0, ty1 - ty0, cur(s)->op, xy, 0, 0, tx1 - tx0, ty1 - ty0, pc_ga, pc_ga, pc_ga, pc_ga);
      } else {   // ponytail: si no hubo memoria para guardarlo y se pintó opaco, sale opaco (sólo con malloc fallando)
        gpu_scratch(d + (size_t)ty0 * stride + tx0, stride, tx0, ty0, tx1 - tx0, ty1 - ty0, op_force >= 0 ? op_force : cur(s)->op);
      }
      scr_n++; scr_px += (unsigned long)(tx1 - tx0) * (ty1 - ty0);
      {
        const int w = scr_why >= 0 ? scr_why : fn == cv_text ? W_TEXT : (fn == cv_draw || fn == cv_putImageData) ? W_IMG : W_OTHER;
        why_n[w]++; why_px[w] += (unsigned long)(tx1 - tx0) * (ty1 - ty0);
      }
      if(trace_left > 0 && trace_left--)
        fprintf(stderr, "[borrador] %s(%d) %dx%d en %d,%d op %d recorte %d\n", FNS[magic].name, argc > 1 ? (int)num(ctx, argv[1]) : -1,
                tx1 - tx0, ty1 - ty0, tx0, ty0, op_force >= 0 ? op_force : cur(s)->op, cur(s)->clipped);
      for(int y = ty0; y < ty1; y++) memset(d + (size_t)y * stride + tx0, 0, (size_t)(tx1 - tx0) * 4);
      tx0 = tx1 = 0;
    }
    op_force = -1;
    pc_slot = -1; pc_ga = 1;
    scr_why = -1;
    tcut = 0;
    // Un lienzo fuera de pantalla que cambia: su textura, a subir otra vez cuando se use.
    if(canvas_last_id >= 0 && canvas_last_id < n_surfs && canvas_last_id != scr &&
       (fn == cv_paint || fn == cv_text || fn == cv_draw || fn == cv_putImageData || fn == cv_resize))
      surfs[canvas_last_id].dirty = 1;
  } else r = FNS[magic].fn(ctx, this, argc, argv);
  prof_cyc[magic] += CYCLES() - t0;
  prof_n[magic]++;
  return r;
}

// Una línea para el log: ms por fotograma dibujando y las funciones que más cuestan (desde la última llamada).
void
canvas_prof(void (*say)(const char *fmt, ...), unsigned long frames) {
  static unsigned long long last_tsc;
  static struct timespec last_ts;
  struct timespec ts;
  unsigned long long now = CYCLES(), tot = 0;
  double cyc_ms;
  char buf[512];
  int len = 0, top[4] = { -1, -1, -1, -1 };
  clock_gettime(CLOCK_MONOTONIC, &ts);
  if(last_tsc && frames) {
    double ms = (ts.tv_sec - last_ts.tv_sec) * 1e3 + (ts.tv_nsec - last_ts.tv_nsec) / 1e6;
    cyc_ms = ms > 0 ? (now - last_tsc) / ms : 0;
    for(int i = 0; i < NFNS; i++) tot += prof_cyc[i];
    for(int k = 0; k < 4; k++)
      for(int i = 0; i < NFNS; i++)
        if(prof_cyc[i] && (top[k] < 0 || prof_cyc[i] > prof_cyc[top[k]]) && (k < 1 || i != top[0]) && (k < 2 || i != top[1]) && (k < 3 || i != top[2])) top[k] = i;
    if(cyc_ms > 0) {
      len = snprintf(buf, sizeof buf, "[dibujo] %.1f ms por fotograma:", tot / cyc_ms / frames);
      for(int k = 0; k < 4 && top[k] >= 0 && len < (int)sizeof buf - 80; k++)
        len += snprintf(buf + len, sizeof buf - len, " %s %.1f ms (%llu)", FNS[top[k]].name + 3, prof_cyc[top[k]] / cyc_ms / frames, prof_n[top[k]] / frames);
      if(gpu_on) len += snprintf(buf + len, sizeof buf - len, " · borrador %lu (%.0f kpx)", scr_n / frames, scr_px / 1e3 / frames);
      say("%s\n", buf);
      if(gpu_on && scr_n) {   // (diagnóstico) por qué: los 5 que más píxeles suben, por fotograma
        len = snprintf(buf, sizeof buf, "[borrador]");
        for(int k = 0; k < 5; k++) {
          int b = -1;
          for(int i = 0; i < W_N; i++) if(why_px[i] && (b < 0 || why_px[i] > why_px[b])) b = i;
          if(b < 0) break;
          len += snprintf(buf + len, sizeof buf - len, "%s %s %.1f (%.0f kpx)", k ? " ·" : "", WHY[b], (double)why_n[b] / frames, why_px[b] / 1e3 / frames);
          why_px[b] = 0;
        }
        say("%s\n", buf);
      }
    }
  }
  memset(prof_cyc, 0, sizeof prof_cyc); memset(prof_n, 0, sizeof prof_n);
  scr_n = scr_px = 0;
  memset(why_n, 0, sizeof why_n); memset(why_px, 0, sizeof why_px);
  last_tsc = now; last_ts = ts;
}

void
canvas_register(JSContext *ctx, JSValue ps) {
  JSClassDef def = { "SurfaceHold", .finalizer = hold_finalizer };
  JS_NewClassID(&hold_class);
  JS_NewClass(JS_GetRuntime(ctx), hold_class, &def);
  if(getenv("PS_GPU_TRACE")) trace_left = atoi(getenv("PS_GPU_TRACE"));
  for(int i = 0; i < NFNS; i++)
    JS_SetPropertyStr(ctx, ps, FNS[i].name, JS_NewCFunctionMagic(ctx, dispatch, FNS[i].name, FNS[i].n, JS_CFUNC_generic_magic, i));
}
