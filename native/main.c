/* PokéSurvivor nativo para PS5 (ver native/README.md).
 *
 * QuickJS ejecuta el JS del juego tal cual, con un navegador mínimo hecho en JS
 * (native/shim): el canvas va por canvas.c (PlutoVG + un blit propio), el resto
 * de lo que el juego pide al navegador lo imitan los shims. SDL2 sólo da el
 * DualSense; la imagen va directa a VideoOut (salida de vídeo propia).
 *
 * El JS ve un objeto global `ps`:
 *   ps.cv_*                      el canvas (canvas.c); ps.SCREEN es el lienzo de la pantalla
 *   ps.W, ps.H                   tamaño de la pantalla en píxeles de dibujo (960x540)
 *   ps.pad() -> { lx, ly, rx, ry, l2, r2, b }   (b: bits SDL_CONTROLLER_BUTTON_*)
 *   ps.rumble(grave, agudo, ms[, i])  vibración, 0..1 (i: el mando del jugador i+1)
 *   ps.now() -> ms               reloj monótono (performance.now)
 *   ps.load(ruta)                ejecuta otro .js en el ámbito global (como un <script>)
 *   ps.readFile(ruta) -> texto | null      ps.writeFile(ruta, texto) -> bool   ps.writeFileLater(ruta, texto)
 *   ps.log(texto)                ps.notify(texto)   (aviso de la consola)
 *   ps.presentMs() -> [copiar, esperar]
 *   ps.au_*                      Web Audio (audio.c), para native/shim/audio.js
 *   ps.tw_*                      el suelo del mapa en otro hilo (tiles_worker.c)
 *   ps.gc(motivo)                recolector de ciclos (no hay automático)    ps.jsBytes() -> memoria del JS
 * y define `frame(ms)`, que se llama una vez por fotograma.
 *
 * Salir: mantener Create 2 s (Options es la pausa del juego).
 * Uso: eboot.elf [ruta del .js]   (por defecto <plat_root()>/shim/boot.js)
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// @step native/main event "main(): rutas y log"
// plat_root()/plat_data(), stdout/stderr a data/log.txt.
// @next upd
// @step native/boot event "shim/boot.js"
// browser.js (window/document mínimos), env.js + mezcla de ps.server, shims net/canvas/audio.
// @sub server
// @next scripts
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#ifdef PS5_TITLE
int backtrace(void **buf, int n);   // la de libps5platform (--defsym backtrace=ps5_backtrace en build-title.sh)
#elif defined(_WIN32) || defined(__SWITCH__) || defined(__ANDROID__)   // (Android: execinfo.h desde la API 33)
#define backtrace(b, n) 0           // ponytail: sin pila al cerrarse en Windows (sólo diagnóstico)
#define backtrace_symbols_fd(b, n, fd) ((void)0)
#else
#include <execinfo.h>
#endif
#include <pthread.h>
#include <stdint.h>
#include <stdarg.h>
#ifdef PS5_TITLE
#include <xmmintrin.h>   // (_mm_getcsr/_mm_setcsr: coma flotante del título, ver main)
#endif
#ifdef _WIN32
#include <windows.h>   // (MoveFileExA: js_writeFile)
#endif
#ifndef _WIN32   // (Windows: sin getrusage ni el socket de take_over; ver abajo)
#include <sys/resource.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#endif
#include <fcntl.h>
#include <sys/stat.h>
#include <math.h>

#include <SDL2/SDL.h>
#include "quickjs.h"
#include "canvas.h"
#include "gpu.h"
void core_register(JSContext *ctx, JSValue ps);   // core_js.c: el núcleo de la partida en C (ps.core_*)
#include "audio.h"
#include "tiles_worker.h"
#include "net.h"
#include "update.h"
#include "webrtc.h"
#include "platform.h"

#ifdef PS5_TITLE
// Título (native/title, ver TITLE.md): sale pidiéndoselo a la consola (exit/_exit cuentan como cierre por error).
// El CRT llama a catchReturnFromMain al volver de main.
void catchReturnFromMain(int status);   // platform/ps5.c
#define _exit(n) catchReturnFromMain(n)
#endif
// root: los archivos del juego (shim/, game/, vendor/); data: donde se escribe (log.txt, user/, miniaturas).
// En la PS5 son la misma carpeta; en escritorio, junto al ejecutable y la carpeta del usuario (platform.h).
static const char *root, *data;
static int FW, FH;            // la pantalla en píxeles de dibujo (plat_screen_size: PS5 960x540; escritorio, la de Ajustes)

#if !defined(PS5_TITLE) && (defined(_WIN32) || defined(__APPLE__) || defined(__linux__) || defined(__SWITCH__))
#define DESKTOP 1                               // Mac, Linux (Steam Deck), Windows y Switch: mandos por eventos de SDL (p_added, abajo)
#endif
#define MAXP 4                                  // jugadores en la misma consola (núcleo en C: shim/core.js)
static SDL_GameController *pad, *pads[MAXP];    // pad: el del jugador 1; pads[1..3]: los de los jugadores 2-4 (✕ en su mando)
static Uint32 *fb;                              // la pantalla (FW x FH, ARGB premultiplicado, el formato de PlutoVG)

// ---------------- el log ----------------
// En memoria y escrito por un hilo aparte cada 0,5 s: escribir en /data desde el bucle frenaba el
// fotograma unos 20 ms (se veía cada 5 s, con la línea [frame]). Si el programa revienta, on_crash
// vuelca lo pendiente antes de salir.
#define LOGBUF (64 * 1024)
static char logbuf[LOGBUF];
static size_t loglen;
static pthread_mutex_t log_mx = PTHREAD_MUTEX_INITIALIZER;

static int
vsay(const char *fmt, va_list ap) {
  char buf[1024];
  int n = vsnprintf(buf, sizeof buf, fmt, ap);
  if(n <= 0) return n;
  if(n >= (int)sizeof buf) n = sizeof buf - 1;
  pthread_mutex_lock(&log_mx);
  if(loglen + n <= LOGBUF) { memcpy(logbuf + loglen, buf, n); loglen += n; }   // lleno: se pierde la línea, no se espera
  pthread_mutex_unlock(&log_mx);
  return n;
}

static void
say(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vsay(fmt, ap);
  va_end(ap);
}

#ifdef PS5_TITLE
// fprintf a stderr/stdout, de quien sea (también RADV, dentro de vkQueueSubmit): al búfer del log (--wrap=fprintf en
// build-title.sh). En la PS5 el cerrojo de stderr se quedaba segundos en manos de otro hilo y el del juego, que
// escribía ahí (la línea «radv/ps5 submissions» de cada vkQueueSubmit), se congelaba con él: imagen parada y, en
// cooperativo, «esperando al anfitrión» (18-11-2026; la prueba del vigilante: «stderr ATASCADO», decimales bien).
int __real_fprintf(FILE *f, const char *fmt, ...);
int
__wrap_fprintf(FILE *f, const char *fmt, ...) {
  va_list ap;
  int n;
  va_start(ap, fmt);
  n = f == stderr || f == stdout ? vsay(fmt, ap) : vfprintf(f, fmt, ap);
  va_end(ap);
  return n;
}
int __real_vfprintf(FILE *f, const char *fmt, va_list ap);
int
__wrap_vfprintf(FILE *f, const char *fmt, va_list ap) {   // (los avisos de Mesa van por aquí)
  return f == stderr || f == stdout ? vsay(fmt, ap) : __real_vfprintf(f, fmt, ap);
}
#define CRASH_PRINTF(...) __real_fprintf(stderr, __VA_ARGS__)   // al cerrar: directo (el búfer ya no se escribiría)
#else
#define CRASH_PRINTF(...) fprintf(stderr, __VA_ARGS__)
#endif

// Diagnóstico (ritmo, fotogramas lentos, gc…): en la PS5 (PS5_DEV: el título y el payload).
#ifdef PS5_DEV
#define dsay say
#else
#define dsay(...) (0 ? say(__VA_ARGS__) : (void)0)   // (nunca se llama; así no avisa de variables sin usar)
#endif

static void
log_flush(void) {
  static char out[LOGBUF];
  size_t n;
  pthread_mutex_lock(&log_mx);
  n = loglen;
  memcpy(out, logbuf, n);
  loglen = 0;
  pthread_mutex_unlock(&log_mx);
  if(n) {
    const Uint64 t0 = SDL_GetTicks64();
    fwrite(out, 1, n, stderr);   // (en un título, write(2) no va al log: sólo stderr)
    const long ms = (long)(SDL_GetTicks64() - t0);
    if(ms > 300) say("[log] escribir %lu B en el log tardó %ld ms\n", (unsigned long)n, ms);   // ¿es este hilo el que retiene stderr?
  }
}

static void*
log_thread(void *arg) {
  for(;;) { usleep(500000); log_flush(); }
  return NULL;
}

// ---------------- API para el JS ----------------

static double
num(JSContext *ctx, JSValueConst v) {
  double d = 0;
  JS_ToFloat64(ctx, &d, v);
  return d;
}

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


// Nintendo (y el Joy-Con suelto): confirmar es la A (derecha) y volver la B (abajo). js_pad las cambia, así ✕ (bit 0) es
// siempre «confirmar» para ui.js, core.js y el juego (native/CLAUDE.md, «Controles»); p_poll lee el confirmar con esto.
static int
nintendo_pad(SDL_GameController *p) {
  const char *t = plat_pad_type(p);
  return !strcmp(t, "nintendo") || !strcmp(t, "joycon");
}

static JSValue
js_pad(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  JSValue o = JS_NewObject(ctx);
  // ps.pad(i): el mando del jugador i+1 (núcleo en C: todos en esta copia); sin i, el del 1.
  const int want = argc > 0 ? (int)num(ctx, argv[0]) : 0;
  SDL_GameController *p = want > 0 && want < MAXP ? pads[want] : want == 0 ? pad : NULL;
  static const char *AN[6] = { "lx", "ly", "rx", "ry", "l2", "r2" };
  static const SDL_GameControllerAxis AX[6] = { SDL_CONTROLLER_AXIS_LEFTX, SDL_CONTROLLER_AXIS_LEFTY, SDL_CONTROLLER_AXIS_RIGHTX,
                                                SDL_CONTROLLER_AXIS_RIGHTY, SDL_CONTROLLER_AXIS_TRIGGERLEFT, SDL_CONTROLLER_AXIS_TRIGGERRIGHT };
  double ax[6];
  int b = 0;
  if(!p) return o;
  for(int i = 0; i < SDL_CONTROLLER_BUTTON_MAX; i++)
    if(SDL_GameControllerGetButton(p, i)) b |= 1 << i;
  for(int i = 0; i < 6; i++) ax[i] = SDL_GameControllerGetAxis(p, AX[i]) / 32767.0;
  plat_pad_adjust(p, &b, ax);   // (Switch: el Joy-Con suelto)
  const char *type = plat_pad_type(p);
  if(nintendo_pad(p)) b = (b & ~3) | (b >> 1 & 1) | (b & 1) << 1;   // (abajo y derecha cambiados: nintendo_pad)
  for(int i = 0; i < 6; i++) JS_SetPropertyStr(ctx, o, AN[i], JS_NewFloat64(ctx, ax[i]));
  JS_SetPropertyStr(ctx, o, "b", JS_NewInt32(ctx, b));
  JS_SetPropertyStr(ctx, o, "type", JS_NewString(ctx, type));
  return o;
}

static JSValue
js_rumble(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  double lo = num(ctx, argv[0]), hi = num(ctx, argv[1]), ms = num(ctx, argv[2]);
  const int i = argc > 3 ? (int)num(ctx, argv[3]) : 0;   // (el mando del jugador i+1: núcleo en C)
  SDL_GameController *p = i > 0 && i < MAXP ? pads[i] : pad;
  if(p) SDL_GameControllerRumble(p, (Uint16)(SDL_clamp(lo, 0, 1) * 65535), (Uint16)(SDL_clamp(hi, 0, 1) * 65535),
                                   (Uint32)SDL_clamp(ms, 0, 5000));
  return JS_UNDEFINED;
}

static JSValue
js_now(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  return JS_NewFloat64(ctx, SDL_GetPerformanceCounter() * 1000.0 / SDL_GetPerformanceFrequency());
}

static JSValue
js_presentMs(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  JSValue a = JS_NewArray(ctx);
  JS_SetPropertyUint32(ctx, a, 0, JS_NewFloat64(ctx, plat_copy_ms));
  JS_SetPropertyUint32(ctx, a, 1, JS_NewFloat64(ctx, plat_wait_ms));
  return a;
}

static JSValue
js_log(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *s = JS_ToCString(ctx, argv[0]);
  if(s) say("%s\n", s);
  JS_FreeCString(ctx, s);
  return JS_UNDEFINED;
}

static JSValue
js_notify(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *s = JS_ToCString(ctx, argv[0]);
  if(s) plat_notify(s);
  JS_FreeCString(ctx, s);
  return JS_UNDEFINED;
}

static JSValue
js_load(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *path = JS_ToCString(ctx, argv[0]);
  size_t len;
  char *src = path ? read_file(path, &len) : NULL;
  JSValue r;
  if(!src) r = JS_ThrowReferenceError(ctx, "no se encuentra %s", path ? path : "?");
  else r = JS_Eval(ctx, src, len, path, JS_EVAL_TYPE_GLOBAL);
  free(src);
  JS_FreeCString(ctx, path);
  return r;
}

static JSValue
js_readFile(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *path = JS_ToCString(ctx, argv[0]);
  size_t len;
  char *src = path ? read_file(path, &len) : NULL;
  // ps.readFile(ruta, true): los bytes tal cual (ArrayBuffer), p. ej. las miniaturas guardadas de ui.js.
  JSValue r = !src ? JS_NULL : argc > 1 && JS_ToBool(ctx, argv[1]) ? JS_NewArrayBufferCopy(ctx, (const uint8_t*)src, len) : JS_NewStringLen(ctx, src, len);
  free(src);
  JS_FreeCString(ctx, path);
  return r;
}

// ps.restart(): recargar (como la página: cambiar de idioma, actualizar). Al final del fotograma se tira el
// contexto JS y se empieza otro en el mismo proceso, con la pantalla, el sonido y el mando abiertos (main).
// Antes se reiniciaba el programa entero por elfldr, pero en la PS5 un payload no suelta la pantalla al salir
// y la copia nueva se quedaba sin ella.
// @step native/req decision "¿reload/relaunch/salir?"
// reload: contexto JS nuevo; relaunch o salir: psFlush y plat_relaunch.
// @next events "sigue"
// @next boot "reload"
// @next main "relaunch"
// @step native/req
static int reload_req, relaunch_req;
static JSValue
js_restart(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  reload_req = 1;
  return JS_TRUE;
}
// ps.relaunch(): guardar, cerrar y volver a abrir el programa entero (escritorio: otra resolución; ver plat_relaunch).
static JSValue
js_relaunch(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  relaunch_req = 1;
  return JS_TRUE;
}

// ps.open_url(url): el navegador por defecto del sistema (escritorio: SDL_OpenURL). false si no se pudo (PS5: nunca).
static JSValue
js_open_url(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *url = JS_ToCString(ctx, argv[0]);
  int ok = 0;
#if defined(_WIN32) || defined(__APPLE__) || defined(__linux__)
  ok = url && !strncmp(url, "https://", 8) && SDL_OpenURL(url) == 0;
#endif
  if(url) JS_FreeCString(ctx, url);
  return JS_NewBool(ctx, ok);
}

// ps.text_input(título, texto, máx., oculto) -> lo escrito, null (cancelado) o undefined (no hay teclado del sistema:
// ui.js usa el suyo). Switch: swkbd. Ver plat_text_input.
static JSValue
js_text_input(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *title = argc > 0 ? JS_ToCString(ctx, argv[0]) : NULL, *init = argc > 1 ? JS_ToCString(ctx, argv[1]) : NULL;
  char out[1024];
  int r = plat_text_input(title ? title : "", init ? init : "", argc > 2 ? (int)num(ctx, argv[2]) : 64,
                          argc > 3 && JS_ToBool(ctx, argv[3]), out, sizeof out);
  if(title) JS_FreeCString(ctx, title);
  if(init) JS_FreeCString(ctx, init);
  return r < 0 ? JS_UNDEFINED : r == 0 ? JS_NULL : JS_NewString(ctx, out);
}

// ps.pad_setup(jugadores, sueltos) -> los mandos conectados, o -1 (cancelado / la plataforma no lo tiene): el applet de
// mandos del sistema (Switch: Joy-Con sueltos o en pareja). Ver plat_pad_setup.
static JSValue
js_pad_setup(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  return JS_NewInt32(ctx, plat_pad_setup(argc > 0 ? (int)num(ctx, argv[0]) : 4, argc > 1 && JS_ToBool(ctx, argv[1])));
}

// ps.drop_take(): la ruta del último archivo arrastrado a la ventana (una vez), o null. Ajustes → Cuenta → «Importar
// partida de un archivo» (el .json de la extensión de chrome-export/). ponytail: SDL2 no trae selector de archivos.
#ifdef DESKTOP   // (el SDL mínimo del título de PS5 no tiene SDL_free ni eventos de ventana)
// ps.text_mode(sí, sacar): el teclado del sistema mientras un campo de ui.js tiene el foco (psTextSink; browser.js lo llama
// en Android y en la Steam Deck). Android: el texto de SDL (y su teclado de la pantalla). Steam Deck: el texto de escritorio
// ya está siempre activo (SDL_StopTextInput lo cortaría); con «sacar» (sin teclado de verdad), el teclado de Steam.
static int text_on;   // (ps.text_mode: se escribe en un campo con el teclado de la pantalla)
static JSValue
js_text_mode(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  static int deck_osk;   // (el de Steam, abierto por aquí)
  text_on = argc > 0 && JS_ToBool(ctx, argv[0]);
  if(getenv("SteamDeck")) {
    if(text_on && argc > 1 && JS_ToBool(ctx, argv[1])) deck_osk = SDL_OpenURL("steam://open/keyboard") == 0;
    else if(!text_on && deck_osk) { SDL_OpenURL("steam://close/keyboard"); deck_osk = 0; }
    return JS_UNDEFINED;
  }
  if(text_on) SDL_StartTextInput(); else SDL_StopTextInput();
  return JS_UNDEFINED;
}

// ps.pick_file() -> true si se abrió el selector de archivos del sistema (Android); lo elegido llega como un archivo
// arrastrado (ps.drop_take). Ver plat_pick_file.
static JSValue
js_pick_file(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  return JS_NewBool(ctx, plat_pick_file());
}

// ps.has_keyboard() -> false si seguro que no hay teclado físico (tablet): ui.js saca el teclado de la pantalla.
static JSValue
js_has_keyboard(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  return JS_NewBool(ctx, plat_has_keyboard());
}

static char *dropped;
static JSValue
js_drop_take(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  JSValue r = dropped ? JS_NewString(ctx, dropped) : JS_NULL;
  SDL_free(dropped); dropped = NULL;
  return r;
}
#endif

// Escribe a un temporal y lo renombra: si se corta a medias, el archivo anterior sigue entero.
static int
write_atomic(const char *path, const char *data, size_t len) {
  char tmp[600];
  FILE *f;
  int ok;
  snprintf(tmp, sizeof tmp, "%s.tmp", path);
  if(!(f = fopen(tmp, "wb"))) return 0;
  ok = fwrite(data, 1, len, f) == len;
  ok = fclose(f) == 0 && ok;
#ifdef _WIN32   // (rename no reemplaza un archivo que ya existe en Windows: MoveFileEx sí, igual de atómico)
  return ok && MoveFileExA(tmp, path, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
#else
  return ok && rename(tmp, path) == 0;
#endif
}

// Escritura en segundo plano (ps.writeFileLater: el localStorage, las miniaturas): en la PS5 escribir en /data a
// veces tarda 1-2 s y congelaba el juego (al comprar en la tienda, al acabar la partida…). Se escriben en orden;
// de un mismo archivo sólo cuenta la última. wf_mx: una escritura a la vez (la de fondo y las directas); wq_*: la cola.
typedef struct wjob { struct wjob *next; char *path, *data; size_t len; } wjob;
static pthread_mutex_t wf_mx = PTHREAD_MUTEX_INITIALIZER, wq_mx = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t wq_cv = PTHREAD_COND_INITIALIZER;
static wjob *wq_head;

static void wjob_free(wjob *j) { if(j) { free(j->path); free(j->data); free(j); } }

// Saca de la cola la de esa ruta (con wq_mx).
static wjob*
wq_drop(const char *path) {
  for(wjob **pp = &wq_head; *pp; pp = &(*pp)->next)
    if(!strcmp((*pp)->path, path)) { wjob *j = *pp; *pp = j->next; return j; }
  return NULL;
}

static void*
writer_thread(void *arg) {
  wjob *j;
  for(;;) {
    pthread_mutex_lock(&wq_mx);
    while(!wq_head) pthread_cond_wait(&wq_cv, &wq_mx);
    pthread_mutex_unlock(&wq_mx);
    pthread_mutex_lock(&wf_mx);   // (antes de sacarla: una directa de después no la pisa con algo más viejo)
    pthread_mutex_lock(&wq_mx);
    if((j = wq_head)) wq_head = j->next;
    pthread_mutex_unlock(&wq_mx);
    if(j && !write_atomic(j->path, j->data, j->len)) say("[guardar] no se pudo escribir %s\n", j->path);
    pthread_mutex_unlock(&wf_mx);
    wjob_free(j);
  }
  return NULL;
}

// Una directa sustituye a la pendiente del mismo archivo (es más nueva) y espera a la que se esté escribiendo.
static int
write_now(const char *path, const char *data, size_t len) {
  wjob *old;
  int ok;
  pthread_mutex_lock(&wq_mx);
  old = wq_drop(path);
  pthread_mutex_unlock(&wq_mx);
  wjob_free(old);
  pthread_mutex_lock(&wf_mx);
  ok = write_atomic(path, data, len);
  pthread_mutex_unlock(&wf_mx);
  return ok;
}

static JSValue
js_writeFile(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *path = JS_ToCString(ctx, argv[0]);
  size_t len;
  // Un ArrayBuffer se escribe tal cual; lo demás, como texto.
  const uint8_t *bin = JS_GetArrayBuffer(ctx, &len, argv[1]);
  const char *data = bin ? (const char*)bin : (JS_FreeValue(ctx, JS_GetException(ctx)), JS_ToCStringLen(ctx, &len, argv[1]));
  int ok = path && data && write_now(path, data, len);
  JS_FreeCString(ctx, path);
  if(!bin) JS_FreeCString(ctx, data);
  return JS_NewBool(ctx, ok);
}

// ps.writeFileLater(ruta, texto | ArrayBuffer): como writeFile, pero sin esperar (hilo aparte). Si ya había una
// pendiente de esa ruta, se descarta (ésta es más nueva).
static JSValue
js_writeFileLater(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  static int started;
  size_t len;
  const char *path = JS_ToCString(ctx, argv[0]);
  const uint8_t *bin = JS_GetArrayBuffer(ctx, &len, argv[1]);
  const char *data = bin ? (const char*)bin : (JS_FreeValue(ctx, JS_GetException(ctx)), JS_ToCStringLen(ctx, &len, argv[1]));
  wjob *j = calloc(1, sizeof *j), *old;
  int ok = j && path && data && (j->path = strdup(path)) && (j->data = malloc(len ? len : 1));
  if(ok) { memcpy(j->data, data, len); j->len = len; }
  JS_FreeCString(ctx, path);
  if(!bin) JS_FreeCString(ctx, data);
  if(!ok) { wjob_free(j); return JS_FALSE; }
  if(!started) { pthread_t t; if(!pthread_create(&t, NULL, writer_thread, NULL)) { pthread_detach(t); started = 1; } }
  if(!started) { ok = write_now(j->path, j->data, j->len); wjob_free(j); return JS_NewBool(ctx, ok); }   // (sin hilo: como antes)
  pthread_mutex_lock(&wq_mx);
  old = wq_drop(j->path);
  wjob **pp = &wq_head;
  while(*pp) pp = &(*pp)->next;
  *pp = j;
  pthread_cond_signal(&wq_cv);
  pthread_mutex_unlock(&wq_mx);
  wjob_free(old);
  return JS_TRUE;
}

// Muestra el error de JS en el aviso de la consola y en el log. Devuelve 1 si había error.
static int
check(JSContext *ctx, JSValue v) {
  if(!JS_IsException(v)) { JS_FreeValue(ctx, v); return 0; }
  JSValue e = JS_GetException(ctx), stack = JS_GetPropertyStr(ctx, e, "stack");
  const char *msg = JS_ToCString(ctx, e), *st = JS_ToCString(ctx, stack);
  char buf[1024];
  snprintf(buf, sizeof buf, "PokeSurvivor JS: %s\n%s", msg ? msg : "?", st ? st : "");
  static int shown;
  say("%s\n", buf);
  if(shown++ < 3) plat_notify(buf);   // un error que se repite cada fotograma no llena la pantalla de avisos
  JS_FreeCString(ctx, msg); JS_FreeCString(ctx, st);
  JS_FreeValue(ctx, stack); JS_FreeValue(ctx, e);
  return 1;
}

// Si el programa revienta, que el log diga dónde: la señal, en qué fase iba y la última llamada de dibujo.
static const char *volatile phase = "arranque";
const char *volatile gpu_step = "";
static volatile unsigned long frames;

static void
on_crash(int sig) {
  char buf[256];
  void *bt[32];
  int n = snprintf(buf, sizeof buf, "\n*** CIERRE: señal %d en «%s», último dibujo %s(%d)\n", sig, phase, canvas_last, canvas_last_id);
  fwrite(logbuf, 1, loglen, stderr);   // lo pendiente del log (sin cerrojo: el programa se va igual)
  fwrite(buf, 1, n, stderr);
  fflush(stderr);
#ifndef PS5_TITLE
  backtrace_symbols_fd(bt, backtrace(bt, 32), 2);
#else
  // La pila en direcciones; con «ref» (dónde está on_crash) se buscan en build/llvm-pie.elf del título.
  int k = backtrace(bt, 32);
  CRASH_PRINTF("ref on_crash %p\n", (void*)on_crash);
  for(int i = 0; i < k; i++) CRASH_PRINTF("  #%d %p\n", i, bt[i]);
  fflush(stderr);
#endif
  plat_notify(buf);
  _exit(1);
}

#ifdef PS5_TITLE
// Con SA_SIGINFO: también la dirección que falló y la instrucción (rip), que la pila a veces no da.
#include <ucontext.h>
static void
on_crash_info(int sig, siginfo_t *si, void *uc) {
  CRASH_PRINTF("\n*** señal %d: dirección %p, rip %p\n", sig, si ? si->si_addr : NULL,
          uc ? (void*)((ucontext_t*)uc)->uc_mcontext.mc_rip : NULL);
  on_crash(sig);
}

// Diagnóstico de cuelgues (18-11-2026: la GPU en cooperativo): el vigilante manda SIGUSR2 al hilo del juego cuando lleva
// unos segundos parado, y éste escribe dónde está (rip, la pila y las direcciones de código que haya en su pila) y sigue.
// Para leerlo: llvm-symbolizer sobre build/llvm-pie.elf, restando (ref - dirección de on_crash en el .elf).
// Sólo %p/%d/%s: los decimales (%f) pasan por un cerrojo de la libc que es justo lo que se sospecha atascado.
static pthread_t game_tid;
static volatile int game_tid_set;
static volatile uintptr_t game_stack_top;
static void
on_stuck(int sig, siginfo_t *si, void *uc) {
  (void)sig; (void)si;
  void *bt[48];
  const mcontext_t *mc = uc ? &((ucontext_t*)uc)->uc_mcontext : NULL;
  fprintf(stderr, "\n*** atascado: ref on_crash %p · rip %p rsp %p rbp %p\n", (void*)on_crash,
          mc ? (void*)mc->mc_rip : NULL, mc ? (void*)mc->mc_rsp : NULL, mc ? (void*)mc->mc_rbp : NULL);
  if(mc) {
    // En una llamada al sistema: rax = número, rdi/rsi/rdx = argumentos (_umtx_op: rdi es el cerrojo, y su primera
    // palabra, el hilo que lo tiene).
    fprintf(stderr, "  rax %p rdi %p rsi %p rdx %p r10 %p\n", (void*)mc->mc_rax, (void*)mc->mc_rdi, (void*)mc->mc_rsi,
            (void*)mc->mc_rdx, (void*)mc->mc_r10);
    const uintptr_t a = (uintptr_t)mc->mc_rdi;
    if(a > 0x100000 && !(a & 7) && a < 0x800000000000ull) {
      const volatile uintptr_t *w = (const volatile uintptr_t*)a;
      fprintf(stderr, "  en rdi: %p %p %p %p\n", (void*)w[0], (void*)w[1], (void*)w[2], (void*)w[3]);
    }
  }
  int k = backtrace(bt, 48);
  for(int i = 0; i < k; i++) fprintf(stderr, "  pila #%d %p\n", i, bt[i]);
  // ponytail: Mesa sin punteros de marco no deja que backtrace pase de la señal; las palabras de la pila que caen en el
  // código (±64 MB de on_crash) dan las llamadas igual (con alguna falsa: se ve al simbolizar). Sólo hasta el principio
  // de la pila del hilo (la vez anterior se pasó y reventó).
  if(mc && mc->mc_rsp && game_stack_top > mc->mc_rsp) {
    const uintptr_t ref = (uintptr_t)on_crash, *sp = (const uintptr_t*)mc->mc_rsp;
    const size_t words = (game_stack_top - mc->mc_rsp) / 8;
    for(size_t i = 0, n = 0; i < words && i < 8192 && n < 64; i++) {
      const uintptr_t w = sp[i];
      if(w > ref - 0x4000000 && w < ref + 0x4000000) { fprintf(stderr, "  en pila +%zu: %p\n", i * 8, (void*)w); n++; }
    }
  }
  fflush(stderr);
}

// Pruebas desde otro hilo cuando el del juego está parado: ¿se pueden formatear decimales (cerrojo de dtoa de la libc)?
// ¿se puede coger stderr? Cada una deja su marca; si no la deja, es que ahí también se queda esperando.
static volatile int probe_dec, probe_err;
static void*
probe_thread(void *arg) {
  (void)arg;
  char b[32];
  snprintf(b, sizeof b, "%.1f", 1.5);
  probe_dec = 1;
  flockfile(stderr); funlockfile(stderr);
  probe_err = 1;
  return NULL;
}
#endif

static long
mem_mb(void) {   // memoria máxima usada por el proceso
#if defined(_WIN32) || defined(__SWITCH__)
  return -1;   // ponytail: sólo para el log; GetProcessMemoryInfo si hiciera falta
#else
  struct rusage ru;
  if(getrusage(RUSAGE_SELF, &ru)) return -1;
#ifdef __APPLE__
  return ru.ru_maxrss >> 20;   // (en macOS, en bytes; en los demás, en KiB)
#else
  return ru.ru_maxrss / 1024;
#endif
#endif
}

// El vigilante: si el bucle no avanza en 2 s, dice dónde está atascado (fase, último dibujo, llamadas).
static void*
watchdog(void *arg) {
  unsigned long last = (unsigned long)-1, calls = 0;
  int stuck = 0;
  (void)stuck;
  for(;;) {
    sleep(2);
    if(frames == last) {
#ifdef PS5_TITLE
      ++stuck;
      if(stuck == 2) { pthread_t p; probe_dec = probe_err = 0; if(!pthread_create(&p, NULL, probe_thread, NULL)) pthread_detach(p); }
      if(stuck == 3) say("[vigilante] prueba desde otro hilo: decimales %s, stderr %s\n",
                         probe_dec ? "bien" : "ATASCADO", probe_err ? "bien" : probe_dec ? "ATASCADO" : "(no se llegó)");
      if(stuck == 3 && game_tid_set) pthread_kill(game_tid, SIGUSR2);   // ~6 s parado: que diga dónde (on_stuck)
#endif
      say("[vigilante] atascado en «%s»%s%s, fotograma %lu, último dibujo %s(%d), %lu llamadas de dibujo (+%lu en 2 s), %ld MB\n",
          phase, *gpu_step ? " / " : "", gpu_step, frames, canvas_last, canvas_last_id, canvas_calls, canvas_calls - calls, mem_mb());
    }
    else stuck = 0;
    last = frames;
    calls = canvas_calls;
  }
  return NULL;
}

// ---------------- memoria del JS y el recolector ----------------
// El recolector de ciclos de QuickJS recorre todos los objetos: con el juego (~190 MB) paraba la partida
// 100-300 ms de vez en cuando. Se quita el automático y se lanza a mano (ps.gc) cuando no molesta:
// browser.js lo hace en pausa, cartas y menús, y en partida sólo si la memoria crece demasiado.
// Para saber cuánta usa, un asignador con cabecera que lleva la cuenta (el de QuickJS no la da sin recorrerlo todo).
static size_t js_bytes;   // (un runtime con su cuenta aparte la lleva en JSMallocState.opaque)
#define HDR 16
#define COUNT(st) (*(size_t*)((st)->opaque ? (st)->opaque : &js_bytes))

static void*
js_malloc_(JSMallocState *st, size_t n) {
  size_t *p = malloc(n + HDR);
  if(!p) return NULL;
  *p = n; COUNT(st) += n;
  return (char*)p + HDR;
}

static void
js_free_(JSMallocState *st, void *ptr) {
  size_t *p;
  if(!ptr) return;
  p = (size_t*)((char*)ptr - HDR);
  COUNT(st) -= *p;
  free(p);
}

static void*
js_realloc_(JSMallocState *st, void *ptr, size_t n) {
  size_t *p, old;
  if(!ptr) return n ? js_malloc_(st, n) : NULL;
  if(!n) { js_free_(st, ptr); return NULL; }
  p = (size_t*)((char*)ptr - HDR);
  old = *p;
  p = realloc(p, n + HDR);
  if(!p) return NULL;
  *p = n; COUNT(st) += n - old;
  return (char*)p + HDR;
}

static size_t
js_usable_(const void *ptr) { return ptr ? *(const size_t*)((const char*)ptr - HDR) : 0; }

static const JSMallocFunctions JS_MF = { js_malloc_, js_free_, js_realloc_, js_usable_ };

// ps.shot(ruta) -> bool: la pantalla, en PNG (pruebas en escritorio, con PS_EVAL_AT; ver native/CLAUDE.md).
#include "plutovg.h"
static JSValue
js_shot(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *path = argc ? JS_ToCString(ctx, argv[0]) : NULL;
  plutovg_surface_t *s;
  bool ok;
  canvas_screen_sync(1);   // (con la pantalla en la GPU, fb es un borrador: se trae y luego se vacía)
  s = path ? plutovg_surface_create_for_data((unsigned char*)fb, FW, FH, FW * 4) : NULL;
  ok = s && plutovg_surface_write_to_png(s, path);
  plutovg_surface_destroy(s);
  canvas_screen_sync(0);
  if(path) JS_FreeCString(ctx, path);
  return JS_NewBool(ctx, ok);
}

static JSValue
js_gc(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  Uint64 t0 = SDL_GetPerformanceCounter();
  size_t *cnt = &js_bytes, before = *cnt;
  const char *why = argc ? JS_ToCString(ctx, argv[0]) : NULL;
  JS_RunGC(JS_GetRuntime(ctx));
  dsay("[gc] %s: %.0f ms, %zu -> %zu MB\n", why ? why : "?", (SDL_GetPerformanceCounter() - t0) * 1000.0 / SDL_GetPerformanceFrequency(),
      before >> 20, *cnt >> 20);
  JS_FreeCString(ctx, why);
  return JS_UNDEFINED;
}

static JSValue
js_jsBytes(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) { return JS_NewFloat64(ctx, (double)js_bytes); }

// Las promesas (los .then) se resuelven aquí; un error en una no para el juego, sólo se avisa.
static void
run_jobs(JSRuntime *rt) {
  JSContext *jctx;
  int r;
  while((r = JS_ExecutePendingJob(rt, &jctx)) != 0)
    if(r < 0) check(jctx, JS_EXCEPTION);
}

// Promesas rechazadas que nadie atiende: el navegador las avisa en la consola; QuickJS se las calla.
// Al log, con su pila (así se ven los fallos de dentro del SDK de Firebase, que van todos en promesas).
static void
on_rejection(JSContext *c, JSValueConst promise, JSValueConst reason, JS_BOOL handled, void *opaque) {
  if(handled) return;
  JSValue stack = JS_IsObject(reason) ? JS_GetPropertyStr(c, reason, "stack") : JS_UNDEFINED;
  const char *m = JS_ToCString(c, reason), *st = JS_IsUndefined(stack) ? NULL : JS_ToCString(c, stack);
  say("[promesa] rechazada sin atender: %s\n%s", m ? m : "?", st ? st : "");
  JS_FreeCString(c, m); JS_FreeCString(c, st);
  JS_FreeValue(c, stack);
}

// El JS: un runtime para todo el programa y un contexto que se cambia al recargar (ps.restart).
static JSRuntime *rt;
static JSContext *ctx;
static JSValue global, frame;
static int screen_id = -1;

#ifdef DESKTOP
static int kb_slot;   // la plaza del teclado y el ratón: 0 = con el jugador 1 (ps.core_kb, abajo)
// Android (tablet con teclado): alguien ya juega con el teclado (una tecla de verdad: no «atrás» ni el teclado de la
// pantalla). Entonces el teclado (y el táctil) son el J1 y cada mando espera su confirmar para entrar como J2-J4.
static int kb_used;
#endif
#if (defined(PS5_TITLE) && defined(PS5_DEV)) || defined(DESKTOP)
// ps.core_pads() -> los mandos que hay (un bit cada uno; ✕ en otro mando lo suma: p_poll, abajo).
static JSValue
js_core_pads(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int bits = 1;
  for(int i = 1; i < MAXP; i++) if(pads[i]) bits |= 1 << i;
#ifdef DESKTOP
  bits |= 1 << kb_slot;
#endif
  return JS_NewInt32(ctx, bits);
}
#endif

#ifdef DESKTOP
// ps.core_kb(unirse) -> la plaza del teclado. Si el jugador 1 tiene mando y unirse es 1 (core.js: Enter/Espacio en
// partida o en la pantalla de Cooperativo local), el teclado entra como un jugador más en la primera plaza libre, igual
// que un mando. Con -1 vuelve al jugador 1 (ui.js: al salir de esa pantalla).
static JSValue
js_core_kb(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  if(kb_slot && argc > 0 && num(ctx, argv[0]) < 0) { say("[p1] el teclado vuelve al jugador 1\n"); kb_slot = 0; }
  if(!kb_slot && pad && argc > 0 && num(ctx, argv[0]) > 0) {
    int me = 1;
    while(me < MAXP && pads[me]) me++;
    if(me < MAXP) { kb_slot = me; say("[p%d] Enter en el teclado: entra el jugador %d (teclado y ratón)\n", me + 1, me + 1); }
  }
  return JS_NewInt32(ctx, kb_slot);
}
#endif

#if defined(PS5_TITLE) && defined(PS5_DEV)
static int32_t p_user[MAXP];   // el usuario de la PS5 de cada mando (el 1, title_user())

// ps.core_user(i) -> el usuario de la PS5 de ese mando ("1a2b3c4d", como la carpeta user/ de su partida) o "".
static JSValue
js_core_user(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int i = argc > 0 ? (int)num(ctx, argv[0]) : 0;
  char id[16] = "";
  if(i > 0 && i < MAXP && pads[i]) snprintf(id, sizeof id, "%08x", (uint32_t)p_user[i]);
  return JS_NewString(ctx, id);
}
#endif

#ifdef PS5_TITLE
// ps.USER_NAME: el nombre del perfil (el del cooperativo local, en su plaza).
static void
user_name(JSContext *ctx, JSValue ps, int32_t user) {
  char name[32];
  if(plat_user_name(user, name, sizeof name) == 0) JS_SetPropertyStr(ctx, ps, "USER_NAME", JS_NewString(ctx, name));
}
#endif

// Lo básico de ps.* (mandos, tiempo, log, archivos, memoria).
static void
ps_basic(JSContext *ctx, JSValue ps) {
#define FN(name, fn, n) JS_SetPropertyStr(ctx, ps, name, JS_NewCFunction(ctx, fn, name, n))
  FN("pad", js_pad, 0);
  FN("rumble", js_rumble, 3);
  FN("now", js_now, 0);
  FN("log", js_log, 1);
  FN("notify", js_notify, 1);
  FN("load", js_load, 1);
  FN("readFile", js_readFile, 1);
  FN("writeFile", js_writeFile, 2);
  FN("writeFileLater", js_writeFileLater, 2);
  FN("presentMs", js_presentMs, 0);
  FN("gc", js_gc, 1);
  FN("jsBytes", js_jsBytes, 0);
  FN("restart", js_restart, 0);
  FN("shot", js_shot, 1);
  FN("relaunch", js_relaunch, 0);
  FN("open_url", js_open_url, 1);
  FN("pad_setup", js_pad_setup, 2);
  FN("text_input", js_text_input, 4);
#if defined(DESKTOP) && (defined(_WIN32) || defined(__APPLE__) || defined(__linux__))
  FN("drop_take", js_drop_take, 0);
  FN("text_mode", js_text_mode, 1);
  FN("pick_file", js_pick_file, 0);
  FN("has_keyboard", js_has_keyboard, 0);
#endif
#if (defined(PS5_TITLE) && defined(PS5_DEV)) || defined(DESKTOP)
  FN("core_pads", js_core_pads, 1);
#endif
#ifdef DESKTOP
  FN("core_kb", js_core_kb, 1);
#endif
#if defined(PS5_TITLE) && defined(PS5_DEV)
  FN("core_user", js_core_user, 1);
#endif
#undef FN
}

// Contexto nuevo con ps.* y boot.js cargado. 0 si va bien.
static int
// @step platforms/runtime build "Runtime nativo"
// Lo mismo en todas: C + QuickJS ejecutando el JS de la web con shims.
// @sub native
// @step native/qjs
js_start(const char *script) {
  JSValue ps;
  size_t len;
  char *src;
  ctx = JS_NewContext(rt);
  global = JS_GetGlobalObject(ctx);
  ps = JS_NewObject(ctx);
  ps_basic(ctx, ps);
  // @step native/qjs
  upd_register(ctx, ps);
  canvas_register(ctx, ps);
  core_register(ctx, ps);
  if(audio_init(ctx, ps)) say("[main] sin audio: %s\n", SDL_GetError());   // el juego sigue, sin sonido
  if(tiles_worker_init(ctx, ps, root, say)) say("[main] sin hilo del suelo: se pinta en el principal\n");
  if(net_init(ctx, ps, root, say)) say("[main] sin red: el juego va en local\n");
  rtc_init(ctx, ps, say);
  if(screen_id < 0) {
    char fonts[600];
    snprintf(fonts, sizeof fonts, "%s/game/assets/fonts", root);
    canvas_set_font_dir(fonts);
    screen_id = canvas_screen(fb, FW, FH);
  }
  JS_SetPropertyStr(ctx, ps, "SCREEN", JS_NewInt32(ctx, screen_id));
  JS_SetPropertyStr(ctx, ps, "W", JS_NewInt32(ctx, FW));
  JS_SetPropertyStr(ctx, ps, "H", JS_NewInt32(ctx, FH));
  JS_SetPropertyStr(ctx, ps, "ROOT", JS_NewString(ctx, root));
  JS_SetPropertyStr(ctx, ps, "DATA", JS_NewString(ctx, data));
  JS_SetPropertyStr(ctx, ps, "PLATFORM", JS_NewString(ctx, PLAT_NAME));
  JS_SetPropertyStr(ctx, ps, "GPU", JS_NewBool(ctx, gpu_on));   // (la pantalla la pinta la GPU: copiar un lienzo a ella es casi gratis)
  if(getenv("PS_EVAL_AT")) JS_SetPropertyStr(ctx, ps, "EVAL_AT", JS_NewString(ctx, getenv("PS_EVAL_AT")));   // (boot.js lo ejecuta a los 2 s)
#ifdef PS5_TITLE
  {   // La partida de cada perfil de la PS5 en data/user/<usuario> (como gb5); browser.js la busca ahí con ps.USER.
      // La de antes (data/localStorage.json) pasa al primer perfil que abra el juego sin partida propia.
    extern int32_t title_user(void);
    int32_t u = title_user();
    if(u >= 0) {
      char id[16], users[96], dir[128], to[160], old[128];
      snprintf(id, sizeof id, "%08x", (uint32_t)u);
      snprintf(users, sizeof users, "%s/user", data);
      snprintf(dir, sizeof dir, "%s/%s", users, id);
      snprintf(to, sizeof to, "%s/localStorage.json", dir);
      snprintf(old, sizeof old, "%s/localStorage.json", data);
      mkdir(users, 0777); mkdir(dir, 0777);
      chmod(users, 0777); chmod(dir, 0777);   // (el FTP, otro proceso, las lista y las copia)
      if(access(to, F_OK) != 0 && rename(old, to) == 0) say("[perfil] localStorage.json: ahora del usuario %s\n", id);
      JS_SetPropertyStr(ctx, ps, "USER", JS_NewString(ctx, id));
      user_name(ctx, ps, u);
    }
  }
#endif
  JS_SetPropertyStr(ctx, ps, "LANG", JS_NewString(ctx, plat_lang()));
  JS_SetPropertyStr(ctx, ps, "PAD", JS_NewString(ctx, pad ? SDL_GameControllerName(pad) : ""));
  JS_SetPropertyStr(ctx, global, "ps", ps);
  if(!(src = read_file(script, &len))) {
    char msg[700];
    snprintf(msg, sizeof msg, "PokeSurvivor: no se encuentra %s", script);
    plat_notify(msg);
    return 1;
  }
  phase = "carga del JS";
  if(check(ctx, JS_Eval(ctx, src, len, script, JS_EVAL_TYPE_GLOBAL))) { free(src); return 1; }
  free(src);
  phase = "promesas del arranque";
  // @step native/present platform "Promesas y presentar"
  // run_jobs y plat_present.
  // @next req
  run_jobs(rt);
  frame = JS_GetPropertyStr(ctx, global, "frame");
  return 0;
}

// Guardar lo pendiente (localStorage del shim) y tirar el contexto: el recolector suelta sus lienzos, imágenes
// y nodos de audio. Lo que quede por llegar de la red es de este contexto y se tira (net_reset).
static void
js_stop(void) {
  JSValue flush = JS_GetPropertyStr(ctx, global, "psFlush");
  if(JS_IsFunction(ctx, flush)) check(ctx, JS_Call(ctx, flush, global, 0, NULL));
  JS_FreeValue(ctx, flush);
  run_jobs(rt);           // las promesas pendientes, antes de tirar el contexto que usan
  net_reset();
  rtc_reset();
  JS_FreeValue(ctx, frame);
  JS_FreeValue(ctx, global);
  JS_FreeContext(ctx);
  JS_RunGC(rt);
  ctx = NULL;
}

#if defined(PS5_TITLE) && defined(PS5_DEV)
// ---------------- jugadores 2-4 (núcleo en C, shim/core.js: todos en esta copia) ----------------
extern SDL_GameController *title_pad_new(int32_t *who);
extern int title_pad_handle(SDL_GameController *p);
extern int32_t title_user(void);

// Mandos de otros usuarios con sesión en la PS5: cada segundo se abre el de uno nuevo (en espera); cuando pulsa ✕, entra
// en la primera plaza libre (y core.js lo suma a la partida). Un usuario con sesión pero sin mando no ocupa plaza (con 4 sesiones y
// 3 mandos, el cuarto quedaba «listo» sin poder jugar, y la partida esperaba su carta para siempre).
static SDL_GameController *waiting[MAXP];   // abiertos, esperando su ✕
static int32_t waiting_user[MAXP];
static void
p_poll(Uint64 now) {
  static Uint64 last;
  for(int w = 0; w < MAXP; w++) {
    if(!waiting[w] || !SDL_GameControllerGetButton(waiting[w], SDL_CONTROLLER_BUTTON_A)) continue;
    int me = 1;
    while(me < MAXP && pads[me]) me++;
    if(me >= MAXP) break;
    pads[me] = waiting[w]; p_user[me] = waiting_user[w]; waiting[w] = NULL;
    say("[p%d] ✕ en otro mando (usuario %08x, mando %d; el jugador 1: usuario %08x, mando %d): entra el jugador %d, proceso %ld MB\n",
        me + 1, (uint32_t)p_user[me], title_pad_handle(pads[me]), (uint32_t)title_user(), title_pad_handle(pad), me + 1, mem_mb());
  }
  if(now - last < 1000) return;
  last = now;
  int w = 0;
  while(w < MAXP && waiting[w]) w++;
  if(w < MAXP && (waiting[w] = title_pad_new(&waiting_user[w])))
    say("[local] mando de otro usuario (%08x, mando %d): en espera de su ✕\n", (uint32_t)waiting_user[w], title_pad_handle(waiting[w]));
}
#endif

#ifdef DESKTOP
// ---------------- mandos en escritorio (USB o Bluetooth: SDL los da igual) ----------------
// El primero que se conecta es el del jugador 1, sin más. Cada uno de después queda en espera hasta que su jugador pulsa
// confirmar (✕ en PlayStation, A en Xbox y en Nintendo: la A de Nintendo es la de la derecha) y entra en la primera
// plaza libre (2-4), en el orden en que lo pulsan; core.js lo suma a la partida. Se reconocen los que SDL sabe leer
// como mando (su base de mandos y los de HIDAPI: PlayStation, Xbox, Switch y casi todos los genéricos).
static SDL_GameController *waiting[MAXP];   // abiertos, esperando su confirmar

static void
p_added(int dev) {
  if(!SDL_IsGameController(dev) || SDL_GameControllerFromInstanceID(SDL_JoystickGetDeviceInstanceID(dev))) return;   // (ya abierto)
  SDL_GameController *p = SDL_GameControllerOpen(dev);
  if(!p) return;
  const char *n = SDL_GameControllerName(p);
  if(!pad && !kb_used) { pad = p; say("[p1] mando: %s (%s)\n", n ? n : "?", plat_pad_type(p)); return; }
  for(int w = 0; w < MAXP; w++)
    if(!waiting[w]) { waiting[w] = p; say("[local] mando nuevo: %s (%s), en espera de confirmar\n", n ? n : "?", plat_pad_type(p)); return; }
  SDL_GameControllerClose(p);   // ponytail: más de 4 en espera, se ignora
}

// Al desconectarse deja libre su plaza (su jugador se queda quieto en la partida); el siguiente que confirme la ocupa.
// Si era el del jugador 1, el próximo mando que se conecte pasa a ser el suyo.
static void
p_removed(SDL_JoystickID id) {
  SDL_GameController *p = SDL_GameControllerFromInstanceID(id);
  if(!p) return;
  if(p == pad) pad = NULL;
  for(int i = 0; i < MAXP; i++) {
    if(pads[i] == p) { pads[i] = NULL; say("[p%d] mando desconectado\n", i + 1); }
    if(waiting[i] == p) waiting[i] = NULL;
  }
  if(!pad) say("[p1] mando desconectado\n");
  if(!pad && kb_slot) { say("[p1] el teclado vuelve al jugador 1\n"); kb_slot = 0; }   // (el J1 no se queda sin nada)
  SDL_GameControllerClose(p);
}

// ¿Pulsa algún botón?
static int
p_any(SDL_GameController *p) {
  for(int i = 0; i < SDL_CONTROLLER_BUTTON_MAX; i++) if(SDL_GameControllerGetButton(p, i)) return 1;
  return 0;
}

static void
p_poll(Uint64 now) {
  static SDL_GameController *used;   // el mando del J1, en cuanto pulsa algo
  (void)now;
  if(pad && pad != used && p_any(pad)) used = pad;
  // El teclado es el J1 (kb_used): un mando del J1 sin usar (uno de verdad conectado antes, o el teclado mismo visto
  // como mando: los de tablet suelen tener cruceta) se queda en espera, como los demás.
  if(kb_used && pad && pad != used) {
    for(int w = 0; w < MAXP; w++) if(!waiting[w]) { waiting[w] = pad; break; }
    say("[p1] el teclado es el jugador 1: %s, en espera de confirmar\n", SDL_GameControllerName(pad) ? SDL_GameControllerName(pad) : "?");
    pad = NULL;
  }
  // Un «mando» que nunca se ha usado no se queda el J1: Android da como mando cualquier dispositivo con cruceta o ejes
  // (en el emulador, una pantalla táctil; hay teclados y mandos a distancia así). El primero de verdad que pulse un
  // botón pasa a ser el J1 (si no, entraría como J2: cooperativo con un solo mando, y los menús no le harían caso).
  if(pad && pad != used && !kb_used)
    for(int w = 0; w < MAXP; w++)
      if(waiting[w] && p_any(waiting[w])) {
        SDL_GameController *old = pad;
        pad = used = waiting[w]; waiting[w] = old;
        say("[p1] %s pulsa un botón: es el del jugador 1 (%s, sin usar, queda en espera)\n", SDL_GameControllerName(pad),
            SDL_GameControllerName(old) ? SDL_GameControllerName(old) : "?");
        return;   // (esa pulsación no cuenta como confirmar de otro jugador)
      }
  for(int w = 0; w < MAXP; w++) {
    SDL_GameController *p = waiting[w];
    if(!p || !SDL_GameControllerGetButton(p, nintendo_pad(p) ? SDL_CONTROLLER_BUTTON_B : SDL_CONTROLLER_BUTTON_A))   // (confirmar)
      continue;
    int me = 1;
    while(me < MAXP && (pads[me] || me == kb_slot)) me++;
    if(me >= MAXP) break;
    pads[me] = p; waiting[w] = NULL;
    say("[p%d] confirma: entra el jugador %d (%s)\n", me + 1, me + 1, plat_pad_type(p));
  }
}
#endif

// Una sola copia del juego: si se abre otra vez desde el lanzador sin haber salido (Create 2 s), la vieja seguía
// corriendo sin pantalla, con su música. Cada copia escucha en un puerto local; la nueva le manda "salir"
// (guarda y termina, y suelta la pantalla) y espera a quedarse con el puerto.
#define ONE_PORT 9173
static int one_fd = -1;

static void
take_over(void) {
#if defined(PS5_TITLE) || defined(_WIN32) || defined(__SWITCH__)
  return;   // un título sólo se abre una vez: la consola ya lo controla (y en escritorio no hace falta)
#else
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons(ONE_PORT);
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if((one_fd = socket(AF_INET, SOCK_DGRAM, 0)) < 0) return;
  for(int i = 0; i < 60; i++) {   // ponytail: 6 s; si la vieja no contesta, se sigue sin el aviso
    if(!bind(one_fd, (struct sockaddr*)&a, sizeof a)) { fcntl(one_fd, F_SETFL, O_NONBLOCK); return; }
    if(i % 10 == 0) sendto(one_fd, "salir", 5, 0, (struct sockaddr*)&a, sizeof a);
    usleep(100000);
  }
  close(one_fd);
  one_fd = -1;
#endif
}

// ¿Ha pedido salir otra copia que se está abriendo?
static int
asked_to_quit(void) {
#ifdef _WIN32
  return 0;
#else
  char b[8];
  return one_fd >= 0 && recv(one_fd, b, sizeof b, 0) > 0;
#endif
}

// Teclado y ratón (escritorio; la PS5 no los tiene): a psInput de browser.js, que los da al juego como en la web.
// x, y: en píxeles de dibujo (FW x FH; SDL ya deshace el escalado de la ventana).
static void
input(const char *type, const char *key, int n, int x, int y) {
  static int logged;
  if(logged < 12 && strcmp(type, "mousemove")) { logged++; dsay("[entrada] %s %s %d\n", type, key, n); }   // (diagnóstico: llegan las teclas)
  JSValue f = JS_GetPropertyStr(ctx, global, "psInput");
  if(!JS_IsFunction(ctx, f)) { static int warned; if(!warned++) say("[entrada] sin psInput en el JS\n"); }
  else {
    JSValue a[5] = { JS_NewString(ctx, type), JS_NewString(ctx, key), JS_NewInt32(ctx, n), JS_NewInt32(ctx, x), JS_NewInt32(ctx, y) };
    check(ctx, JS_Call(ctx, f, global, 5, a));
    for(int i = 0; i < 5; i++) JS_FreeValue(ctx, a[i]);
  }
  JS_FreeValue(ctx, f);
}

#ifdef PS5_TITLE
#define main game_main   // (el main del título está al final: lo lanza en un hilo con pila grande)
#endif
int
main(int argc, char **argv) {
  static char boot[600], logp[600];
  const char *script = argc > 1 ? argv[1] : boot;
  Uint64 create_down = 0;
  int quit = 0;

  root = plat_root(); data = plat_data();
  snprintf(boot, sizeof boot, "%s/shim/boot.js", root);
  snprintf(logp, sizeof logp, "%s/log.txt", data);
  // Todo lo que se escribe va a data/log.txt (make -C native log).
  // freopen no reutiliza el descriptor 2 en esta libc: los dos (1 y 2) se apuntan al log a mano.
  // @step native/main
  if(freopen(logp, "w", stderr)) {
    int fd = fileno(stderr);
    dup2(fd, 1);
    if(fd != 2) dup2(fd, 2);
    setvbuf(stderr, NULL, _IONBF, 0);
    setvbuf(stdout, NULL, _IONBF, 0);
  }

  // @step native/upd event "upd_init"
  // Antes de leer nada: versión instalada vs binario; en escritorio puede pasar a otro binario (exec).
  // @sub nupdate
  // @next sdl
  upd_init(root, data, say, argv);   // antes de leer nada del juego: ¿versión instalada o la del binario?
  take_over();
#ifdef PS5_TITLE
#ifdef PS5_DEV
  { extern unsigned title_mxcsr_before, title_mxcsr_after; fprintf(stderr, "[main] MXCSR %#x -> %#x (hilo del juego: %#x)\n", title_mxcsr_before, title_mxcsr_after, _mm_getcsr()); }
#endif
  {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_sigaction = on_crash_info;
    sa.sa_flags = SA_SIGINFO;
    const int sigs[] = { SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGABRT };
    for(size_t i = 0; i < sizeof sigs / sizeof *sigs; i++) sigaction(sigs[i], &sa, NULL);
    sa.sa_sigaction = on_stuck;
    sa.sa_flags = SA_SIGINFO | SA_RESTART;
    sigaction(SIGUSR2, &sa, NULL);
    game_tid = pthread_self(); game_stack_top = (uintptr_t)__builtin_frame_address(0); game_tid_set = 1;
  }
#else
  signal(SIGSEGV, on_crash); signal(SIGILL, on_crash);
#ifdef SIGBUS   // (Windows no la tiene)
  signal(SIGBUS, on_crash);
#endif
  signal(SIGFPE, on_crash); signal(SIGABRT, on_crash);
#endif

#ifdef SDL_HINT_GAMECONTROLLER_USE_BUTTON_LABELS
  SDL_SetHint(SDL_HINT_GAMECONTROLLER_USE_BUTTON_LABELS, "0");   // botones por posición (✕ = el de abajo en todos; ui.js pinta su letra)
#endif
  // @step native/sdl platform "SDL, mando y vídeo"
  // SDL_Init, primer mando, plat_video_init.
  // @next qjs
  if(SDL_Init(SDL_INIT_GAMECONTROLLER | SDL_INIT_AUDIO)) {
    plat_notify(SDL_GetError());
    return 1;
  }
  for(int i = 0; i < SDL_NumJoysticks() && !pad; i++)
    if(SDL_IsGameController(i) && (pad = SDL_GameControllerOpen(i))) say("[p1] mando al arrancar: %s\n", SDL_GameControllerName(pad));
  plat_screen_size(&FW, &FH);
  // @step native/sdl
  if((!(fb = calloc((size_t)FW * FH, 4)) && SDL_SetError("sin memoria")) || plat_video_init(fb, FW, FH)) {
    char buf[256];
    snprintf(buf, sizeof buf, "PokeSurvivor: sin pantalla (%s)", SDL_GetError());
    say("%s\n", buf);
    log_flush();
    plat_notify(buf);
    _exit(1);   // salir de main con hilos vivos (SDL) acababa en señal 11
  }

  // @step native/qjs build "QuickJS y ps.*"
  // JS_NewRuntime2; js_start registra ps.* (update, canvas, core, audio, tiles, net, rtc).
  // @next boot
  rt = JS_NewRuntime2(&JS_MF, NULL);
  JS_SetGCThreshold(rt, (size_t)-1);   // sin recolector automático: lo lanza browser.js (ps.gc)
#ifdef _WIN32
  // ponytail: en Windows la pila del hilo principal vive en direcciones bajas y «tope − 4 MB» da la vuelta: QuickJS
  // creía desbordada la pila en la primera línea. Sin su límite; la pila es de 16 MB (Makefile.desktop, --stack).
  JS_SetMaxStackSize(rt, 0);
#else
  JS_SetMaxStackSize(rt, 4 << 20);
#endif
  JS_SetHostPromiseRejectionTracker(rt, on_rejection, NULL);
  {
    pthread_t t;
    int rc = pthread_create(&t, NULL, watchdog, NULL);
    pthread_create(&t, NULL, log_thread, NULL);
    dsay("[main] vigilante %s, %ld MB\n", rc ? "NO arrancó" : "en marcha", mem_mb());
  }
  if(js_start(script)) { log_flush(); _exit(1); }

  while(!quit) {
    SDL_Event ev;
    Uint64 now;
    JSValue arg;

    // @step native/events event "SDL_PollEvent"
    // Teclado, ratón, toque, mando y texto → G_.psInput; en segundo plano, psFlush.
    // @next frame
    while(SDL_PollEvent(&ev)) {
      if(ev.type == SDL_QUIT) quit = 1;
#ifdef DESKTOP
      if(ev.type == SDL_CONTROLLERDEVICEADDED) p_added(ev.cdevice.which);
      if(ev.type == SDL_CONTROLLERDEVICEREMOVED) p_removed(ev.cdevice.which);
#else
      if(ev.type == SDL_CONTROLLERDEVICEADDED && !pad) pad = SDL_GameControllerOpen(ev.cdevice.which);
#endif
#ifdef DESKTOP   // teclado, ratón, arrastrar archivos y foco: no en PS5 (su SDL mínimo no los tiene)
      if(ev.type == SDL_KEYDOWN && !ev.key.repeat && !kb_used && !strcmp(PLAT_NAME, "android") && !text_on &&
         ev.key.keysym.scancode != SDL_SCANCODE_AC_BACK) {   // (kb_used: sólo Android; en escritorio siempre hay teclado)
        kb_used = 1;
        say("[p1] teclado: es el del jugador 1 (%s)\n", SDL_GetScancodeName(ev.key.keysym.scancode));
      }
      if(ev.type == SDL_KEYDOWN || ev.type == SDL_KEYUP)
        input(ev.type == SDL_KEYDOWN ? "keydown" : "keyup", SDL_GetScancodeName(ev.key.keysym.scancode), ev.key.repeat, 0, 0);
      if(ev.type == SDL_MOUSEMOTION) { int mx = ev.motion.x, my = ev.motion.y; plat_mouse(&mx, &my); input("mousemove", "", 0, mx, my); }
      if(ev.type == SDL_MOUSEBUTTONDOWN || ev.type == SDL_MOUSEBUTTONUP) {
        int mx = ev.button.x, my = ev.button.y;
        plat_mouse(&mx, &my);   // (con la GPU o un toque: de la ventana a la pantalla del juego)
        input(ev.type == SDL_MOUSEBUTTONDOWN ? "mousedown" : "mouseup", "", ev.button.button, mx, my);
      }
      // (y > 0: hacia arriba; en centésimas de muesca: con el trackpad casi todos los movimientos son de menos de una)
      if(ev.type == SDL_MOUSEWHEEL) input("wheel", "", (int)lroundf(ev.wheel.preciseY * 100), 0, 0);
      if(ev.type == SDL_DROPFILE) { SDL_free(dropped); dropped = ev.drop.file; }   // (ps.drop_take)
      if(ev.type == SDL_TEXTINPUT) input("text", ev.text.text, 0, 0, 0);    // (lo escrito, ya en UTF-8: los campos de texto de ui.js)
      // Al perder el foco (⌘+Tab, Alt+Tab…) las teclas pulsadas no mandan keyup: browser.js las suelta todas.
      if(ev.type == SDL_WINDOWEVENT && ev.window.event == SDL_WINDOWEVENT_FOCUS_LOST) input("blur", "", 0, 0, 0);
      // Pantalla táctil con cada dedo por separado (la plataforma pone SDL_HINT_TOUCH_MOUSE_EVENTS a 0: escritorio, Switch y
      // Android). n: el dedo; x, y: de la ventana a la pantalla del juego, como el ratón. Los trackpads (indirectos: el del
      // Mac también da dedos) siguen siendo el ratón.
      if((ev.type == SDL_FINGERDOWN || ev.type == SDL_FINGERMOTION || ev.type == SDL_FINGERUP) &&
         !SDL_GetHintBoolean(SDL_HINT_TOUCH_MOUSE_EVENTS, SDL_TRUE) &&
         SDL_GetTouchDeviceType(ev.tfinger.touchId) != SDL_TOUCH_DEVICE_INDIRECT_ABSOLUTE &&
         SDL_GetTouchDeviceType(ev.tfinger.touchId) != SDL_TOUCH_DEVICE_INDIRECT_RELATIVE) {
        SDL_Window *w = SDL_GetWindowFromID(ev.tfinger.windowID);
        int ww = 0, wh = 0;
        if(!w) w = SDL_GetKeyboardFocus();
        if(w) SDL_GetWindowSize(w, &ww, &wh);
        int fx = (int)(ev.tfinger.x * ww), fy = (int)(ev.tfinger.y * wh);
        if(gpu_on) plat_mouse(&fx, &fy);
        else { fx = (int)(ev.tfinger.x * FW); fy = (int)(ev.tfinger.y * FH); }   // ponytail: sin GPU, sin contar las bandas (ventana no 16:9)
        input(ev.type == SDL_FINGERDOWN ? "touchstart" : ev.type == SDL_FINGERUP ? "touchend" : "touchmove", "",
              (int)(ev.tfinger.fingerId & 0xffff), fx, fy);
      }
      // El sistema va a dejar la app en segundo plano (móvil): puede cerrarla sin avisar, así que se guarda ya.
      if(ev.type == SDL_APP_WILLENTERBACKGROUND) {
        JSValue flush = JS_GetPropertyStr(ctx, global, "psFlush");
        if(JS_IsFunction(ctx, flush)) check(ctx, JS_Call(ctx, flush, global, 0, NULL));
        JS_FreeValue(ctx, flush);
        log_flush();
      }
      if(ev.type == SDL_APP_TERMINATING) quit = 1;
#endif
    }
    now = SDL_GetTicks64();
    arg = JS_NewFloat64(ctx, SDL_GetPerformanceCounter() * 1000.0 / SDL_GetPerformanceFrequency());
    // ponytail: un error en un fotograma no cierra el juego; se avisa y se sigue (como el navegador).
    Uint64 f0 = SDL_GetPerformanceCounter(), f1, f2;
    unsigned long loads0 = canvas_loads, calls0 = canvas_calls;
    if(frames < 3) dsay("[fotograma %lu] JS… (%lu llamadas de dibujo, %ld MB)\n", frames, canvas_calls, mem_mb());
#if (defined(PS5_TITLE) && defined(PS5_DEV)) || defined(DESKTOP)
    p_poll(now);
#endif
    phase = "frame (JS)";
    check(ctx, JS_Call(ctx, frame, global, 1, &arg));
    if(frames < 3) dsay("[fotograma %lu] promesas… (%lu llamadas de dibujo, %ld MB)\n", frames, canvas_calls, mem_mb());
    phase = "promesas";
    run_jobs(rt);
    if(frames < 3) dsay("[fotograma %lu] presentar…\n", frames);
    f1 = SDL_GetPerformanceCounter();
    phase = "presentar";
    // @step native/present
    plat_present();
    f2 = SDL_GetPerformanceCounter();
    frames++;
    {
      // Los fotogramas lentos (más de 25 ms sin contar la espera al vblank), con su motivo probable.
      double k = 1000.0 / SDL_GetPerformanceFrequency(), js = (f1 - f0) * k, total = (f2 - f0) * k - plat_wait_ms;
      static double work_sum, work_max, beat;
      static unsigned long beat_frames, missed;
      work_sum += total; if(total > work_max) work_max = total;
      if(total > 16.6) missed++;
      beat_frames++;
      if((f2 * k) - beat > 5000) {
        if(beat) dsay("[ritmo] %lu fotogramas: trabajo medio %.1f ms, máximo %.1f ms, %lu se pasaron de 16,7 ms (copiar %.1f ms)\n",
                     beat_frames, work_sum / beat_frames, work_max, missed, plat_copy_ms);
        canvas_prof(say, beat ? beat_frames : 0);
        if(gpu_on) gpu_prof(say, beat ? beat_frames : 0);
        beat = f2 * k; work_sum = work_max = 0; beat_frames = missed = 0;
      }
      if(frames > 5 && total > 25)
        dsay("[lento] fotograma %lu: %.0f ms (JS+dibujo %.0f, copiar %.0f), %lu imágenes cargadas, %lu llamadas de dibujo, %ld MB\n",
            frames, total, js, plat_copy_ms, canvas_loads - loads0, canvas_calls - calls0, mem_mb());
    }
    if(frames <= 5) {   // los primeros fotogramas: cuánto cuesta cada uno
      static Uint64 prev;
      Uint64 t = SDL_GetPerformanceCounter();
      if(prev) dsay("[fotograma %lu] %.1f ms, %lu llamadas de dibujo\n", frames,
                      (t - prev) * 1000.0 / SDL_GetPerformanceFrequency(), canvas_calls);
      prev = t;
    }

    if(reload_req) {   // ps.restart(): otro contexto JS, como recargar la página
      reload_req = 0;
      say("[main] recargar el JS\n");
      js_stop();
      if(js_start(script)) { log_flush(); _exit(1); }
      say("[main] recargado, %ld MB\n", mem_mb());
      continue;
    }
    if(relaunch_req) { say("[main] reabrir el programa\n"); quit = 1; }
    if(asked_to_quit()) { say("[main] se abre otra copia: ésta guarda y sale\n"); quit = 1; }
    if(pad && SDL_GameControllerGetButton(pad, SDL_CONTROLLER_BUTTON_BACK)) {
      if(!create_down) create_down = now;
      else if(now - create_down > 2000) quit = 1;
    } else create_down = 0;
  }

  // Salir (Create mantenido): guardar y terminar el proceso con todos sus hilos (volver de main no lo cerraba
  // del todo en la PS5: la pantalla quedaba ocupada).
  {
    JSValue flush = JS_GetPropertyStr(ctx, global, "psFlush");
    if(JS_IsFunction(ctx, flush)) check(ctx, JS_Call(ctx, flush, global, 0, NULL));
    JS_FreeValue(ctx, flush);
  }
  log_flush();
  plat_video_close();
  SDL_Quit();
  // @step native/req
  if(relaunch_req) { if(one_fd >= 0) close(one_fd); plat_relaunch(argv); }   // (el puerto de take_over, libre para la nueva; si vuelve, no se pudo)
  _exit(0);
  return 0;
}

#ifdef PS5_TITLE
#undef main
// La pila del hilo principal de un título es pequeña, y QuickJS cree tener 4 MB (JS_SetMaxStackSize): al
// compilar los scripts grandes se salía de ella sin avisar (señal 11 en «carga del JS»). El juego, en un hilo
// con 64 MB.
static int game_argc;
static char **game_argv;
static void *game_thread(void *arg) { (void)arg; return (void*)(intptr_t)game_main(game_argc, game_argv); }
// Coma flotante como en un payload: con flush-to-zero y denormals-are-zero (MXCSR bits 15 y 6). El arranque de un
// título la deja en IEEE estricto, y cada número diminuto (las transparencias y degradados de PlutoVG, el audio que
// se apaga) pasaba por la vía lenta del procesador: el menú iba a 40 fps con 53 rellenos de 11 ms (31-10-2026).
// Antes de crear ningún hilo: lo heredan (los de la plataforma copian el estado de coma flotante de quien los crea).
unsigned title_mxcsr_before, title_mxcsr_after;
int
main(int argc, char **argv) {
  pthread_attr_t attr;
  pthread_t t;
  void *ret = NULL;
  title_mxcsr_before = _mm_getcsr();
  _mm_setcsr(title_mxcsr_before | 0x8040);
  title_mxcsr_after = _mm_getcsr();
  game_argc = argc; game_argv = argv;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 64u << 20);
  if(pthread_create(&t, &attr, game_thread, NULL)) return game_main(argc, argv);
  pthread_join(t, &ret);
  return (int)(intptr_t)ret;
}
#endif
