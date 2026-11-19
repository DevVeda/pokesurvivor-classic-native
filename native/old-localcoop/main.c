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
 *   ps.rumble(grave, agudo, ms)  vibración, 0..1
 *   ps.now() -> ms               reloj monótono (performance.now)
 *   ps.load(ruta)                ejecuta otro .js en el ámbito global (como un <script>)
 *   ps.readFile(ruta) -> texto | null      ps.writeFile(ruta, texto) -> bool
 *   ps.log(texto)                ps.notify(texto)   (aviso de la consola)
 *   ps.presentMs() -> [copiar, esperar]
 *   ps.au_*                      Web Audio (audio.c), para native/shim/audio.js
 *   ps.tw_*                      el suelo del mapa en otro hilo (tiles_worker.c)
 *   ps.gc(motivo)                recolector de ciclos (no hay automático)    ps.jsBytes() -> memoria del JS
 * y define `frame(ms)`, que se llama una vez por fotograma.
 *
 * Salir: mantener Create 2 s (Options es la pausa del juego).
 * Uso: eboot.elf [ruta del .js]   (por defecto ROOT/shim/boot.js)
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#ifndef PS5_TITLE
#include <execinfo.h>
#else
int backtrace(void **buf, int n);   // la de libps5platform (--defsym backtrace=ps5_backtrace en build-title.sh)
#endif
#include <pthread.h>
#include <stdint.h>
#include <stdarg.h>
#include <xmmintrin.h>   // (_mm_getcsr/_mm_setcsr: coma flotante del título, ver main)
#include <sys/resource.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <math.h>

#include <SDL2/SDL.h>
#include "quickjs.h"
#include "canvas.h"
void core_register(JSContext *ctx, JSValue ps);   // core_js.c: el núcleo de la partida en C (ps.core_*)
#include "audio.h"
#include "tiles_worker.h"
#include "net.h"
#include "webrtc.h"

#ifdef PS5_TITLE
// Título (native/title, ver TITLE.md): su carpeta es /app0 (= /data/homebrew/PPSA77701), y sale pidiéndoselo a la
// consola (exit/_exit cuentan como cierre por error). El CRT llama a catchReturnFromMain al volver de main.
#define ROOT "/app0"
int sceSystemServiceLoadExec(const char *path, const char *const *argv);
int sceKernelUsleep(unsigned us);
void catchReturnFromMain(int status) {
  sceSystemServiceLoadExec("exit", NULL);
  for(;;) sceKernelUsleep(100000);
}
#define _exit(n) catchReturnFromMain(n)
#else
#define ROOT "/data/homebrew/PokeSurvivorNative"
#endif
#define LOG ROOT "/log.txt"   // make -C native log
#define W 1920
#define H 1080
#define FW (W / 2)            // se dibuja a media resolución y se escala ×2 al presentar
#define FH (H / 2)

typedef struct notify_request {
  char useless1[45];
  char message[3075];
} notify_request_t;
int sceKernelSendNotificationRequest(int, notify_request_t*, size_t, int);

#define MAXP 4                                  // jugadores en la misma consola (cooperativo local, abajo)
static SDL_GameController *pad, *pads[MAXP];    // pad: el del jugador 1; pads[1..3]: los de los jugadores 2-4
static Uint32 *fb, *fbs[MAXP], *fbv[MAXP];      // fb: la pantalla del jugador 1 (FW x FH, ARGB premultiplicado, el formato
                                                // de PlutoVG); fbs[i]: donde pinta el jugador i+1; fbv[i]: su último
                                                // fotograma terminado (lo que se ve: nunca a medias)
#define VIEW(i) ((i) ? fbv[i] : fb)
static pthread_mutex_t fbv_mx = PTHREAD_MUTEX_INITIALIZER;
static volatile int split;                      // hay más jugadores
// Cómo se ve (ps.lc_layout, localcoop.js): 0 sólo el 1 · 1 los demás en su cuadrante (menús) · 2 pantalla partida dinámica:
// cada píxel, de la cámara del jugador más cercano (Voronoi), con una línea entre cámaras distintas · 3 una celda cada uno
// (cartas, pausa): 2 en mitades, 3 uno arriba y dos abajo, 4 en 2x2.
static volatile int lc_mode = 1, lc_n;
static volatile float lc_sx[MAXP], lc_sy[MAXP];   // dónde va cada uno en la pantalla (píxeles de salida)
static volatile int lc_src[MAXP];                 // de qué pantalla sale su zona (los que comparten cámara, de la misma)
static volatile int lc_ov = -1, lc_ovy;           // la capa de avisos (ps.lc_overlay: un lienzo del 1, encima de todo)
// El HUD de cada jugador en su esquina (ps.lc_hud): de su lienzo de HUD, su bloque de vida (arriba a la izquierda) y su
// barra de ataques y objeto (abajo), recortados (en píxeles de dibujo) y puestos a 1:1 en su esquina: 1 abajo izq.,
// 2 abajo der., 3 y 4 arriba (la vida encima de la barra). Y su ventana (ps.lc_win: pausa, cartas…), entera a 1:1 en su
// cuarto de pantalla; mientras está abierta, su esquina de HUD no sale.
#define HX0 180
#define HY0 406   // (desde el nombre de la esfera elegida, encima de su fila, encima de los ataques)
#define HW 600
#define HH 134
#define LX0 8
#define LY0 10
#define LW 176
#define LH 46
static volatile int core_pads;                    // núcleo en C (shim/core.js): los mandos que entran no abren otra copia
static volatile int p_on[MAXP];                   // [i]: el jugador i+1 está en marcha (el 1 no cuenta: siempre)
static volatile int lc_hud[MAXP] = { -1, -1, -1, -1 }, lc_win[MAXP] = { -1, -1, -1, -1 };
static volatile float lc_wb[MAXP][4];   // la caja de su ventana (x, y, ancho, alto en píxeles de dibujo; 0: entera)
static volatile Uint32 lc_hudcol[MAXP];
static const int HUD_X[MAXP] = { 16, W - HW - 16, 16, W - HW - 16 },
                 HUD_Y[MAXP] = { H - HH - 16, H - HH - 16, 96 + LH + 6, 96 + LH + 6 },       // la barra
                 LIFE_Y[MAXP] = { H - HH - 16 - LH - 6, H - HH - 16 - LH - 6, 96, 96 },      // la vida, encima
                 QX[MAXP] = { 0, W / 2, 0, W / 2 }, QY[MAXP] = { H / 2, H / 2, 0, 0 };       // su cuarto (la ventana)
static double copy_ms, wait_ms;

static void
notify(const char *msg) {
#ifdef PS5_TITLE
  fprintf(stderr, "[aviso] %s\n", msg);   // ponytail: el aviso de la consola es de libkernel_sys, que un título no tiene
#else
  notify_request_t req;
  memset(&req, 0, sizeof req);
  snprintf(req.message, sizeof req.message, "%s", msg);
  sceKernelSendNotificationRequest(0, &req, sizeof req, 0);
#endif
}

// ---------------- el log ----------------
// En memoria y escrito por un hilo aparte cada 0,5 s: escribir en /data desde el bucle frenaba el
// fotograma unos 20 ms (se veía cada 5 s, con la línea [frame]). Si el programa revienta, on_crash
// vuelca lo pendiente antes de salir.
#define LOGBUF (64 * 1024)
static char logbuf[LOGBUF];
static size_t loglen;
static pthread_mutex_t log_mx = PTHREAD_MUTEX_INITIALIZER;

static void
say(const char *fmt, ...) {
  char buf[1024];
  va_list ap;
  int n;
  va_start(ap, fmt);
  n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if(n <= 0) return;
  if(n >= (int)sizeof buf) n = sizeof buf - 1;
  pthread_mutex_lock(&log_mx);
  if(loglen + n <= LOGBUF) { memcpy(logbuf + loglen, buf, n); loglen += n; }   // lleno: se pierde la línea, no se espera
  pthread_mutex_unlock(&log_mx);
}

// Diagnóstico (ritmo, fotogramas lentos, gc…): sólo en la edición Dev (PS5_DEV: el payload y PPSA77702). En «PokéSurvivor Classic»
// (PPSA77701) el log sólo trae errores.
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
  if(n) fwrite(out, 1, n, stderr);   // (en un título, write(2) no va al log: sólo stderr)
}

static void*
log_thread(void *arg) {
  for(;;) { usleep(500000); log_flush(); }
  return NULL;
}

// ---------------- salida de vídeo propia ----------------
// Sin SDL: su escalado (17 ms) y su copia a la memoria de vídeo en orden disperso costaban más que
// todo el juego. Aquí se escala ×2 y se pasa al formato en mosaico de VideoOut en una sola pasada,
// escribiendo la memoria en orden (es de escritura combinada: lo disperso es muy lento).
// Basado en src/platform/ps5_video.c de PSXS5 (SynoPiia, GPL-3.0-or-later).

typedef struct { void *data, *metadata, *reserved0, *reserved1; } VideoBuffer;
typedef struct { Uint8 reserved[80]; } VideoAttribute;
int sceVideoOutOpen(int user_id, int bus_type, int index, const void *param);
int sceSystemServiceParamGetInt(int param_id, int *value);   // libSceSystemService; 1 = idioma del sistema

// El idioma de la consola (SCE_SYSTEM_LANG_*) como etiqueta BCP 47, para navigator.language.
// El juego usa los que tiene (es, en, fr, it, pt-BR, zh-Hans, zh-Hant); los demás, en inglés.
static const char*
system_lang(void) {
  static const char *TAGS[] = { "ja-JP", "en-US", "fr-FR", "es-ES", "de-DE", "it-IT", "nl-NL", "pt-PT", "ru-RU", "ko-KR",
                                "zh-TW", "zh-CN", "fi-FI", "sv-SE", "da-DK", "nb-NO", "pl-PL", "pt-BR", "en-GB", "tr-TR",
                                "es-419", "ar", "fr-CA", "cs-CZ", "hu-HU", "el-GR", "ro-RO", "th-TH", "vi-VN", "id-ID", "uk-UA" };
  int v = -1;
  if(sceSystemServiceParamGetInt(1, &v) || v < 0 || v >= (int)(sizeof TAGS / sizeof *TAGS)) return "en-US";
  return TAGS[v];
}
int sceVideoOutSetFlipRate(int handle, int rate);
void sceVideoOutSetBufferAttribute2(VideoAttribute *attr, Uint64 pixel_format, Uint32 tiling_mode,
                                    Uint32 width, Uint32 height, Uint64 option, Uint32 dcc_control,
                                    Uint64 dcc_clear_color);
int sceVideoOutRegisterBuffers2(int handle, int set_index, int buffer_index_start, VideoBuffer *buffers,
                                int buffer_count, VideoAttribute *attr, int category, void *option);
int sceVideoOutSubmitFlip(int handle, int buffer_index, Uint32 flip_mode, Sint64 flip_arg);
int sceVideoOutIsFlipPending(int handle);
int sceVideoOutWaitVblank(int handle);
int sceVideoOutClose(int handle);
int sceKernelAllocateMainDirectMemory(size_t len, size_t align, int type, Sint64 *phys);
int sceKernelMapDirectMemory(void **addr, size_t len, int prot, int flags, Sint64 phys, size_t align);

#define VBUFS 3                          // se dibuja en uno mientras otro espera al vblank
#define VFRAME 0x1000000u                // un fotograma 1920x1080 en mosaico, redondeado
#define VBLOCKS_X (W / 128)              // 15 bloques de 128x128 (64 KiB) por fila
#define VBLOCKS_Y ((H + 127) / 128)      // 9 filas de bloques (hasta la fila 1151)

static int vout = -1;
static void copy_start_threads(void);
static Uint32 *vframes[VBUFS];
static int vlast;
static Sint64 vflips = 1;
static Uint16 untile[128 * 128];         // posición en memoria del bloque -> (y << 7 | x)

static int
video_init(void) {
  Sint64 phys = 0;
  void *mem = NULL;
  VideoBuffer bufs[VBUFS];
  VideoAttribute attr;
  int rc;

  // Dentro de un bloque de 64 KiB, el desplazamiento de un píxel es (bits de fila) XOR (bits de columna).
  for(Uint32 y = 0; y < 128; y++) {
    Uint32 row = ((y << 4) & 0x70u) ^ ((y << 5) & 0xf00u) ^ ((y << 9) & 0x1000u) ^ ((y << 8) & 0x4000u);
    for(Uint32 x = 0; x < 128; x++) {
      Uint32 col = ((x << 2) & 0xcu) ^ ((x << 5) & 0x380u) ^ ((x << 4) & 0x400u) ^ ((x << 6) & 0x800u) ^
                   ((x << 9) & 0xa000u);
      untile[(row ^ col) >> 2] = (Uint16)(y << 7 | x);
    }
  }
  if(!(fb = calloc((size_t)FW * FH, 4))) return SDL_SetError("sin memoria para la pantalla");
  // Al reiniciar (ps.restart), la copia anterior aún puede tener la pantalla unos instantes: se reintenta.
  for(int i = 0; (vout = sceVideoOutOpen(0xff, 0, 0, NULL)) < 0 && i < 80; i++) SDL_Delay(100);
  if(vout < 0) return SDL_SetError("sceVideoOutOpen 0x%x", vout);
  if((rc = sceKernelAllocateMainDirectMemory(VFRAME * VBUFS, 0x200000, 3, &phys)))
    return SDL_SetError("sceKernelAllocateMainDirectMemory 0x%x", rc);
  if((rc = sceKernelMapDirectMemory(&mem, VFRAME * VBUFS, 0x33, 0, phys, 0x200000)))
    return SDL_SetError("sceKernelMapDirectMemory 0x%x", rc);
  memset(mem, 0, VFRAME * VBUFS);
  for(int i = 0; i < VBUFS; i++) {
    vframes[i] = (Uint32*)((Uint8*)mem + (size_t)i * VFRAME);
    bufs[i] = (VideoBuffer){ vframes[i], NULL, NULL, NULL };
  }
  memset(&attr, 0, sizeof attr);
  sceVideoOutSetFlipRate(vout, 0);
  sceVideoOutSetBufferAttribute2(&attr, 0x8000000022000000ull, 0, W, H, 0, 0, 0);   // RGBA8, en mosaico
  if((rc = sceVideoOutRegisterBuffers2(vout, 0, 0, bufs, VBUFS, &attr, 0, NULL)))
    return SDL_SetError("sceVideoOutRegisterBuffers2 0x%x", rc);
  sceVideoOutSubmitFlip(vout, 0, 1, vflips++);
  copy_start_threads();
  return 0;
}

// La copia a VideoOut, repartida: COPY_THREADS hilos (el principal incluido), cada uno con sus bloques
// de 128x128. Sola tardaba 3,6 ms, y con el resto del fotograma se pasaba de los 16,7 ms de vez en cuando.
#define COPY_THREADS 4
#define VBLOCKS (VBLOCKS_X * VBLOCKS_Y)

static Uint32 *copy_out;
static pthread_mutex_t copy_mx = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t copy_go = PTHREAD_COND_INITIALIZER, copy_done = PTHREAD_COND_INITIALIZER;
static unsigned copy_gen;
static int copy_left;

static void
copy_blocks(int first, int last) {
  const int mode = lc_mode, n = lc_n;
  float sx[MAXP], sy[MAXP], len[MAXP][MAXP];
  int src[MAXP];
  for(int i = 0; i < n; i++) { sx[i] = lc_sx[i]; sy[i] = lc_sy[i]; src[i] = lc_src[i]; }
  for(int i = 0; i < n; i++) for(int j = 0; j < n; j++) len[i][j] = sqrtf((sx[i] - sx[j]) * (sx[i] - sx[j]) + (sy[i] - sy[j]) * (sy[i] - sy[j]));
  int ow = 0, oh = 0, os = 0;
  const Uint32 *ov = split && lc_ov > 0 ? canvas_pixels(lc_ov, &ow, &oh, &os) : NULL;
  const int oy0 = lc_ovy * 2, oy1 = oy0 + oh * 2;
  const Uint32 *hud[MAXP], *win[MAXP];
  int hs[MAXP], ws[MAXP], np = 0;
  for(int i = 0; i < MAXP; i++) np += i == 0 || p_on[i];   // (los que juegan: su zona, la mitad con dos, el cuarto con más)
  // La ventana, ampliada en su zona (su mitad con dos, su cuarto con más): su caja (lc_wb, píxeles de dibujo) a ×2 con dos
  // y ×1,5 con más, como mucho lo que quepa; centrada. wk: píxeles de dibujo por píxel de salida (×65536).
  int wrx[MAXP], wry[MAXP], wrw[MAXP], wrh[MAXP], wcx[MAXP], wcy[MAXP], wk[MAXP];
  for(int i = 0; i < MAXP; i++) {
    int hw, hh;
    win[i] = split && lc_win[i] > 0 ? canvas_pixels(lc_win[i], &hw, &hh, &ws[i]) : NULL;
    if(win[i] && (hw < FW || hh < FH)) win[i] = NULL;
    if(win[i]) {
      wrx[i] = QX[i]; wry[i] = np <= 2 ? 0 : QY[i]; wrw[i] = W / 2; wrh[i] = np <= 2 ? H : H / 2;
      const float bw = lc_wb[i][2] > 0 ? lc_wb[i][2] : FW, bh = lc_wb[i][3] > 0 ? lc_wb[i][3] : FH;
      float s = np <= 2 ? 2.0f : 1.5f;
      if(s > (wrw[i] - 16) / bw) s = (wrw[i] - 16) / bw;
      if(s > (wrh[i] - 16) / bh) s = (wrh[i] - 16) / bh;
      if(s < 0.5f) s = 0.5f;
      wk[i] = (int)(65536 / s);
      wcx[i] = (int)((lc_wb[i][2] > 0 ? lc_wb[i][0] + bw / 2 : FW / 2) * 65536);
      wcy[i] = (int)((lc_wb[i][3] > 0 ? lc_wb[i][1] + bh / 2 : FH / 2) * 65536);
    }
    hud[i] = split && !win[i] && lc_hud[i] > 0 ? canvas_pixels(lc_hud[i], &hw, &hh, &hs[i]) : NULL;
    if(hud[i] && (hw < HX0 + HW || hh < HY0 + HH)) hud[i] = NULL;
  }
  for(int b = first; b < last; b++) {
    int by = b / VBLOCKS_X, bx = b % VBLOCKS_X;
    Uint32 *out = copy_out + (size_t)b * 128 * 128;
    for(int i = 0; i < 128 * 128; i++) {
      int v = untile[i], y = by * 128 + (v >> 7), x = bx * 128 + (v & 127);
      Uint32 p;
      const int vx = x - W / 2 >= -2 && x - W / 2 < 2, hz = y - H / 2 >= -2 && y - H / 2 < 2;   // en la cruz del centro
      if(y >= H) p = 0;
      else if(!split || mode == 0 || n < 2) p = fb[(y >> 1) * FW + (x >> 1)];   // ×2 al píxel más cercano
      else if(mode == 1) {   // menús: el jugador q+1 en su cuadrante (1 arriba a la derecha, 2 abajo a la izquierda, 3 abajo
        int q = (y >= H / 2) * 2 + (x >= W / 2);     // a la derecha), a 1:1; el 1, detrás
        p = q && q < n && fbv[q] ? (vx || hz ? 0xf4f8ff : fbv[q][(y % FH) * FW + x % FW]) : fb[(y >> 1) * FW + (x >> 1)];
      } else if(mode == 2) {   // la zona del más cercano; la línea, cerca de la mediatriz entre dos cámaras distintas
        int a = -1, c = -1;
        float da = 1e30f, dc = 1e30f;
        for(int i = 0; i < n; i++) {
          float d = (x - sx[i]) * (x - sx[i]) + (y - sy[i]) * (y - sy[i]);
          if(d < da) { dc = da; c = a; da = d; a = i; } else if(d < dc) { dc = d; c = i; }
        }
        p = c >= 0 && src[a] != src[c] && dc - da < 5 * len[a][c] ? 0xf4f8ff   // (dc - da = 2·distancia a la mediatriz·len)
          : VIEW(src[a])[(y >> 1) * FW + (x >> 1)];
      } else {   // una celda cada uno, con su pantalla entera a 1:1 (sin recortar: cartas, pausa), centrada; alrededor, oscuro
        int i, cx0, cy0, cw, ch;   // la celda
        if(n == 2) { i = x >= W / 2; cx0 = i * W / 2; cy0 = 0; cw = W / 2; ch = H; }
        else if(n == 3 && y < H / 2) { i = 0; cx0 = 0; cy0 = 0; cw = W; ch = H / 2; }
        else { i = n == 3 ? 1 + (x >= W / 2) : (y >= H / 2) * 2 + (x >= W / 2); cx0 = (x >= W / 2) * W / 2; cy0 = (y >= H / 2) * H / 2; cw = W / 2; ch = H / 2; }
        const int fx = x - cx0 - (cw - FW) / 2, fy = y - cy0 - (ch - FH) / 2;
        const int line = n == 2 ? vx : n == 3 ? hz || (y >= H / 2 && vx) : vx || hz;
        p = line ? 0xf4f8ff : fx >= 0 && fx < FW && fy >= 0 && fy < FH && VIEW(i) ? VIEW(i)[fy * FW + fx] : 0x0a1430;
      }
      for(int i = 0; i < MAXP; i++) {   // la ventana de cada uno, en su cuarto (encima de todo menos los avisos)
        if(!win[i]) continue;
        if(x < wrx[i] || y < wry[i] || x >= wrx[i] + wrw[i] || y >= wry[i] + wrh[i]) continue;
        const int wx = (wcx[i] + (x - wrx[i] - wrw[i] / 2) * wk[i]) >> 16, wy = (wcy[i] + (y - wry[i] - wrh[i] / 2) * wk[i]) >> 16;
        if(wx < 0 || wy < 0 || wx >= FW || wy >= FH) continue;
        Uint32 o = win[i][wy * ws[i] + wx];
        unsigned a = o >> 24, ia = 255 - a;
        if(a == 255) p = o;
        else if(a) p = (((o >> 16 & 255) + ((p >> 16 & 255) * ia >> 8)) << 16) | (((o >> 8 & 255) + ((p >> 8 & 255) * ia >> 8)) << 8) | ((o & 255) + ((p & 255) * ia >> 8));
        break;
      }
      for(int i = 0; i < MAXP; i++) {   // el HUD de cada uno en su esquina (su vida y su barra), con un borde de su color
        if(!hud[i]) continue;
        int sx0, sy0, rw, rh, hx = x - HUD_X[i], hy = y - HUD_Y[i];
        if(hx >= -2 && hy >= -2 && hx < HW + 2 && hy < HH + 2) { sx0 = HX0; sy0 = HY0; rw = HW; rh = HH; }
        else if((hy = y - LIFE_Y[i]) >= -2 && hy < LH + 2 && hx >= -2 && hx < LW + 2) { sx0 = LX0; sy0 = LY0; rw = LW; rh = LH; }
        else continue;
        if(hx < 0 || hy < 0 || hx >= rw || hy >= rh) { p = lc_hudcol[i]; break; }
        Uint32 o = hud[i][(sy0 + hy) * hs[i] + sx0 + hx];
        unsigned a = o >> 24, ia = 255 - a;
        Uint32 bg = 0x0a1430;   // (fondo oscuro, medio transparente, para que se lea sobre cualquier zona)
        p = ((((p >> 16 & 255) + (bg >> 16 & 255)) >> 1) << 16) | ((((p >> 8 & 255) + (bg >> 8 & 255)) >> 1) << 8) | (((p & 255) + (bg & 255)) >> 1);
        if(a == 255) p = o;
        else if(a) p = (((o >> 16 & 255) + ((p >> 16 & 255) * ia >> 8)) << 16) | (((o >> 8 & 255) + ((p >> 8 & 255) * ia >> 8)) << 8) | ((o & 255) + ((p & 255) * ia >> 8));
        break;
      }
      if(ov && y >= oy0 && y < oy1 && (x >> 1) < ow) {   // la capa de avisos, encima (premultiplicada: o + p·(1 - a))
        Uint32 o = ov[((y - oy0) >> 1) * os + (x >> 1)];
        unsigned a = o >> 24;
        if(a == 255) p = o;
        else if(a) {
          unsigned ia = 255 - a;
          p = (((o >> 16 & 255) + ((p >> 16 & 255) * ia >> 8)) << 16) | (((o >> 8 & 255) + ((p >> 8 & 255) * ia >> 8)) << 8) | ((o & 255) + ((p & 255) * ia >> 8));
        }
      }
      out[i] = 0xff000000 | (p & 0x00ff00) | (p >> 16 & 0xff) | (p & 0xff) << 16;   // ARGB -> bytes R,G,B,A
    }
  }
  __asm__ volatile("sfence" ::: "memory");   // memoria de escritura combinada: que se vea lo escrito
}

static void*
copy_worker(void *arg) {
  int n = (int)(intptr_t)arg;
  unsigned seen = 0;
  for(;;) {
    pthread_mutex_lock(&copy_mx);
    while(copy_gen == seen) pthread_cond_wait(&copy_go, &copy_mx);
    seen = copy_gen;
    pthread_mutex_unlock(&copy_mx);
    copy_blocks(VBLOCKS * n / COPY_THREADS, VBLOCKS * (n + 1) / COPY_THREADS);
    pthread_mutex_lock(&copy_mx);
    if(--copy_left == 0) pthread_cond_signal(&copy_done);
    pthread_mutex_unlock(&copy_mx);
  }
  return NULL;
}

static void
copy_start_threads(void) {
  for(int n = 1; n < COPY_THREADS; n++) {
    pthread_t t;
    pthread_create(&t, NULL, copy_worker, (void*)(intptr_t)n);
  }
}

static void
present(void) {
  double f = 1000.0 / SDL_GetPerformanceFrequency();
  Uint64 t0 = SDL_GetPerformanceCounter(), t1;
  const int target = (vlast + 1) % VBUFS;   // ni en pantalla ni en cola

  const int s2 = split;
  if(s2) pthread_mutex_lock(&fbv_mx);   // (los demás jugadores no copian su fotograma mientras se presenta)
  pthread_mutex_lock(&copy_mx);
  copy_out = vframes[target];
  copy_left = COPY_THREADS - 1;
  copy_gen++;
  pthread_cond_broadcast(&copy_go);
  pthread_mutex_unlock(&copy_mx);
  copy_blocks(0, VBLOCKS / COPY_THREADS);    // la parte del hilo principal
  pthread_mutex_lock(&copy_mx);
  while(copy_left > 0) pthread_cond_wait(&copy_done, &copy_mx);
  pthread_mutex_unlock(&copy_mx);
  if(s2) pthread_mutex_unlock(&fbv_mx);
  t1 = SDL_GetPerformanceCounter();
  // Nunca dos cambios en cola: se espera al anterior (esto es el vsync).
  for(int spins = 0; sceVideoOutIsFlipPending(vout) > 0 && spins < 4; spins++) sceVideoOutWaitVblank(vout);
  sceVideoOutSubmitFlip(vout, target, 1, vflips++);
  vlast = target;
  copy_ms = (t1 - t0) * f;
  wait_ms = (SDL_GetPerformanceCounter() - t1) * f;
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
  FILE *f = fopen(path, "rb");
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

#define PLAYER(ctx) ((int)(intptr_t)JS_GetContextOpaque(ctx))   // 0: quien abrió el juego; 1-3: los jugadores 2-4
#define PAD(ctx) (PLAYER(ctx) ? pads[PLAYER(ctx)] : pad)

static JSValue
js_pad(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  JSValue o = JS_NewObject(ctx);
  // ps.pad(i): el jugador 1 lee el mando de cualquiera (núcleo en C: todos en esta copia).
  const int want = argc > 0 && !PLAYER(ctx) ? (int)num(ctx, argv[0]) : -1;
  SDL_GameController *p = want > 0 && want < MAXP ? pads[want] : want == 0 ? pad : PAD(ctx);
  int b = 0;
  if(!p) return o;
  for(int i = 0; i < SDL_CONTROLLER_BUTTON_MAX; i++)
    if(SDL_GameControllerGetButton(p, i)) b |= 1 << i;
#define AXIS(name, a) JS_SetPropertyStr(ctx, o, name, JS_NewFloat64(ctx, SDL_GameControllerGetAxis(p, a) / 32767.0))
  AXIS("lx", SDL_CONTROLLER_AXIS_LEFTX);
  AXIS("ly", SDL_CONTROLLER_AXIS_LEFTY);
  AXIS("rx", SDL_CONTROLLER_AXIS_RIGHTX);
  AXIS("ry", SDL_CONTROLLER_AXIS_RIGHTY);
  AXIS("l2", SDL_CONTROLLER_AXIS_TRIGGERLEFT);
  AXIS("r2", SDL_CONTROLLER_AXIS_TRIGGERRIGHT);
#undef AXIS
  JS_SetPropertyStr(ctx, o, "b", JS_NewInt32(ctx, b));
  static int pressed[MAXP];   // diagnóstico del cooperativo local: ¿le llega algo del mando de cada jugador?
  if(PLAYER(ctx) && b && !pressed[PLAYER(ctx)]) { pressed[PLAYER(ctx)] = 1; say("[p%d] su mando: primera pulsación (botones %#x)\n", PLAYER(ctx) + 1, b); }
  return o;
}

static JSValue
js_rumble(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  double lo = num(ctx, argv[0]), hi = num(ctx, argv[1]), ms = num(ctx, argv[2]);
  if(PAD(ctx)) SDL_GameControllerRumble(PAD(ctx), (Uint16)(SDL_clamp(lo, 0, 1) * 65535), (Uint16)(SDL_clamp(hi, 0, 1) * 65535),
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
  JS_SetPropertyUint32(ctx, a, 0, JS_NewFloat64(ctx, copy_ms));
  JS_SetPropertyUint32(ctx, a, 1, JS_NewFloat64(ctx, wait_ms));
  return a;
}

static JSValue
js_log(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *s = JS_ToCString(ctx, argv[0]);
  if(s && PLAYER(ctx)) say("[p%d] %s\n", PLAYER(ctx) + 1, s);
  else if(s) say("%s\n", s);
  JS_FreeCString(ctx, s);
  return JS_UNDEFINED;
}

static JSValue
js_notify(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *s = JS_ToCString(ctx, argv[0]);
  if(s) notify(s);
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
static int reload_req;
static JSValue
js_restart(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  if(PLAYER(ctx)) return JS_FALSE;   // ponytail: los jugadores 2-4 no recargan (su copia vive lo que dura la sesión)
  reload_req = 1;
  return JS_TRUE;
}

// Escribe a un temporal y lo renombra: si se corta a medias, el archivo anterior sigue entero.
static JSValue
js_writeFile(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *path = JS_ToCString(ctx, argv[0]);
  size_t len;
  // Un ArrayBuffer se escribe tal cual; lo demás, como texto.
  const uint8_t *bin = JS_GetArrayBuffer(ctx, &len, argv[1]);
  const char *data = bin ? (const char*)bin : (JS_FreeValue(ctx, JS_GetException(ctx)), JS_ToCStringLen(ctx, &len, argv[1]));
  char tmp[600];
  FILE *f;
  int ok = 0;
  // ponytail: los jugadores 2-4 sólo escriben su partida (user/…); lo común (las miniaturas) es del jugador 1.
  if(path && PLAYER(ctx) && !strstr(path, "/user/")) { JS_FreeCString(ctx, path); if(!bin) JS_FreeCString(ctx, data); return JS_FALSE; }
  if(path && data) {
    snprintf(tmp, sizeof tmp, "%s.tmp", path);
    if((f = fopen(tmp, "wb"))) {
      ok = fwrite(data, 1, len, f) == len;
      ok = fclose(f) == 0 && ok;
      ok = ok && rename(tmp, path) == 0;
    }
  }
  JS_FreeCString(ctx, path);
  if(!bin) JS_FreeCString(ctx, data);
  return JS_NewBool(ctx, ok);
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
  if(shown++ < 3) notify(buf);   // un error que se repite cada fotograma no llena la pantalla de avisos
  JS_FreeCString(ctx, msg); JS_FreeCString(ctx, st);
  JS_FreeValue(ctx, stack); JS_FreeValue(ctx, e);
  return 1;
}

// Si el programa revienta, que el log diga dónde: la señal, en qué fase iba y la última llamada de dibujo.
static const char *volatile phase = "arranque";
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
  fprintf(stderr, "ref on_crash %p\n", (void*)on_crash);
  for(int i = 0; i < k; i++) fprintf(stderr, "  #%d %p\n", i, bt[i]);
  fflush(stderr);
#endif
  notify(buf);
  _exit(1);
}

#ifdef PS5_TITLE
// Con SA_SIGINFO: también la dirección que falló y la instrucción (rip), que la pila a veces no da.
#include <ucontext.h>
static void
on_crash_info(int sig, siginfo_t *si, void *uc) {
  fprintf(stderr, "\n*** señal %d: dirección %p, rip %p\n", sig, si ? si->si_addr : NULL,
          uc ? (void*)((ucontext_t*)uc)->uc_mcontext.mc_rip : NULL);
  on_crash(sig);
}
#endif

static long
mem_mb(void) {   // memoria máxima usada por el proceso
  struct rusage ru;
  return getrusage(RUSAGE_SELF, &ru) ? -1 : ru.ru_maxrss / 1024;
}

// El vigilante: si el bucle no avanza en 2 s, dice dónde está atascado (fase, último dibujo, llamadas).
static void*
watchdog(void *arg) {
  unsigned long last = (unsigned long)-1, calls = 0;
  for(;;) {
    sleep(2);
    if(frames == last) {
      say("[vigilante] atascado en «%s», fotograma %lu, último dibujo %s(%d), %lu llamadas de dibujo (+%lu en 2 s), %ld MB\n",
          phase, frames, canvas_last, canvas_last_id, canvas_calls, canvas_calls - calls, mem_mb());
    }
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
static size_t js_bytes, js_bytesp[MAXP];   // jugador 1 y jugadores 2-4 (cada runtime lleva el suyo en JSMallocState.opaque)
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

static JSValue
js_gc(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  Uint64 t0 = SDL_GetPerformanceCounter();
  size_t *cnt = PLAYER(ctx) ? &js_bytesp[PLAYER(ctx)] : &js_bytes, before = *cnt;
  const char *why = argc ? JS_ToCString(ctx, argv[0]) : NULL;
  JS_RunGC(JS_GetRuntime(ctx));
  dsay("[gc] %s: %.0f ms, %zu -> %zu MB\n", why ? why : "?", (SDL_GetPerformanceCounter() - t0) * 1000.0 / SDL_GetPerformanceFrequency(),
      before >> 20, *cnt >> 20);
  JS_FreeCString(ctx, why);
  return JS_UNDEFINED;
}

static JSValue
js_jsBytes(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) { return JS_NewFloat64(ctx, (double)(PLAYER(ctx) ? js_bytesp[PLAYER(ctx)] : js_bytes)); }

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

#if defined(PS5_TITLE) && defined(PS5_DEV)
// Cooperativo local (shim/localcoop.js): un canal en memoria entre las copias del juego (hasta MAXP), mensajes de texto, una
// cola por jugador. ps.lc_send(texto, a) (a: 0-3; sin él, al jugador 1) · ps.lc_recv() -> el siguiente o null ·
// ps.lc_players() -> los que hay (un bit cada uno) · ps.lc_peer() ¿hay alguien más? · ps.lc_layout (abajo).
typedef struct lc_msg { struct lc_msg *next; char *s; size_t n; } lc_msg_t;
static lc_msg_t *lc_head[MAXP], *lc_tail[MAXP];   // [i]: lo que le espera al jugador i+1
static pthread_mutex_t lc_mx = PTHREAD_MUTEX_INITIALIZER;

static JSValue
js_lc_send(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int to = argc > 1 ? (int)num(ctx, argv[1]) : 0;
  if(to < 0 || to >= MAXP || to == PLAYER(ctx)) return JS_UNDEFINED;
  size_t n;
  const char *t = JS_ToCStringLen(ctx, &n, argv[0]);
  lc_msg_t *m = t ? malloc(sizeof *m) : NULL;
  if(m && (m->s = malloc(n ? n : 1))) {
    memcpy(m->s, t, n); m->n = n; m->next = NULL;
    pthread_mutex_lock(&lc_mx);
    if(lc_tail[to]) lc_tail[to]->next = m; else lc_head[to] = m;
    lc_tail[to] = m;
    pthread_mutex_unlock(&lc_mx);
  } else free(m);
  JS_FreeCString(ctx, t);
  return JS_UNDEFINED;
}

static JSValue
js_lc_recv(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int me = PLAYER(ctx);
  pthread_mutex_lock(&lc_mx);
  lc_msg_t *m = lc_head[me];
  if(m && !(lc_head[me] = m->next)) lc_tail[me] = NULL;
  pthread_mutex_unlock(&lc_mx);
  if(!m) return JS_NULL;
  JSValue r = JS_NewStringLen(ctx, m->s, m->n);
  free(m->s); free(m);
  return r;
}

static JSValue
js_lc_players(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int bits = 1;
  for(int i = 1; i < MAXP; i++) if(p_on[i]) bits |= 1 << i;
  return JS_NewInt32(ctx, bits);
}

// ps.core_pads(on) -> los mandos que hay (un bit cada uno). Con on, un ✕ en otro mando sólo lo apunta (sin su copia).
static JSValue
js_core_pads(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  if(argc > 0) core_pads = JS_ToBool(ctx, argv[0]);
  int bits = 1;
  for(int i = 1; i < MAXP; i++) if(pads[i]) bits |= 1 << i;
  return JS_NewInt32(ctx, bits);
}

static JSValue
js_lc_peer(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int any = PLAYER(ctx) != 0;
  for(int i = 1; i < MAXP; i++) any |= p_on[i];
  return JS_NewBool(ctx, any);
}

// ps.lc_layout(modo, quién dibuja (bits), n, x1, y1, v1, x2, y2, v2, …): el jugador 1 dice cómo se ve (lc_mode, arriba), qué
// copias pintan su pantalla (las demás no: no se ve) y, en la pantalla partida, dónde va cada jugador (en píxeles de dibujo,
// 960x540) y de qué pantalla sale su zona (vi: 0-3; los que comparten cámara, la misma).
static volatile int p_draws[MAXP] = { 1, 1, 1, 1 };
// ps.lc_overlay(lienzo, y): ese lienzo del jugador 1, encima de todo a esa altura (píxeles de dibujo), sea cual sea la
// pantalla partida (los avisos de la partida: si no, cada uno lo veía cortado por su zona). -1: nada.
static JSValue
js_lc_overlay(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  if(PLAYER(ctx) || argc < 2) return JS_UNDEFINED;
  lc_ovy = (int)num(ctx, argv[1]);
  lc_ov = (int)num(ctx, argv[0]);
  return JS_UNDEFINED;
}

// ps.lc_win(lienzo, x, y, ancho, alto): la ventana de este jugador (pausa, cartas…) para su zona, y su caja (se amplía
// a ella); -1: ninguna.
static JSValue
js_lc_win(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const int me = PLAYER(ctx);
  for(int k = 0; k < 4; k++) lc_wb[me][k] = argc > k + 1 ? (float)num(ctx, argv[k + 1]) : 0;
  if(argc) lc_win[me] = (int)num(ctx, argv[0]);
  return JS_UNDEFINED;
}

// ps.lc_hud(lienzo, color): el lienzo con el HUD de este jugador (su vida y su barra) para su esquina; -1: nada.
static JSValue
js_lc_hud(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  if(argc < 1) return JS_UNDEFINED;
  lc_hudcol[PLAYER(ctx)] = argc > 1 ? (Uint32)num(ctx, argv[1]) : 0xf4f8ff;
  lc_hud[PLAYER(ctx)] = (int)num(ctx, argv[0]);
  return JS_UNDEFINED;
}

static JSValue
js_lc_layout(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  if(PLAYER(ctx) || argc < 3) return JS_UNDEFINED;
  int mode = (int)num(ctx, argv[0]), draws = (int)num(ctx, argv[1]), n = (int)num(ctx, argv[2]);
  if(n < 0 || n > MAXP || argc < 3 + 3 * n) n = 0;
  for(int i = 0; i < n; i++) {
    int v = (int)num(ctx, argv[5 + 3 * i]);
    lc_sx[i] = (float)(num(ctx, argv[3 + 3 * i]) * 2);
    lc_sy[i] = (float)(num(ctx, argv[4 + 3 * i]) * 2);
    lc_src[i] = v >= 0 && v < MAXP && (!v || fbv[v]) ? v : 0;
  }
  for(int i = 0; i < MAXP; i++) p_draws[i] = draws >> i & 1;
  lc_n = n;
  lc_mode = mode;
  return JS_UNDEFINED;
}
#endif

#ifdef PS5_TITLE
// ps.USER_NAME: el nombre del perfil de la PS5 (el del cooperativo local, en su plaza).
int sceUserServiceGetUserName(int32_t user, char *name, size_t size);
static void
user_name(JSContext *ctx, JSValue ps, int32_t user) {
  char name[32] = "";
  if(sceUserServiceGetUserName(user, name, 17) == 0 && name[0]) JS_SetPropertyStr(ctx, ps, "USER_NAME", JS_NewString(ctx, name));
}
#endif

// Lo de ps.* que tienen todos los jugadores (los 2-4 no tienen audio ni red).
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
  FN("presentMs", js_presentMs, 0);
  FN("gc", js_gc, 1);
  FN("jsBytes", js_jsBytes, 0);
  FN("restart", js_restart, 0);
#if defined(PS5_TITLE) && defined(PS5_DEV)
  FN("lc_send", js_lc_send, 2);
  FN("lc_recv", js_lc_recv, 0);
  FN("lc_peer", js_lc_peer, 0);
  FN("lc_players", js_lc_players, 0);
  FN("lc_layout", js_lc_layout, 3);
  FN("lc_overlay", js_lc_overlay, 2);
  FN("lc_hud", js_lc_hud, 2);
  FN("lc_win", js_lc_win, 1);
  FN("core_pads", js_core_pads, 1);
#endif
  JS_SetPropertyStr(ctx, ps, "PLAYER", JS_NewInt32(ctx, PLAYER(ctx)));
#undef FN
}

// Contexto nuevo con ps.* y boot.js cargado. 0 si va bien.
static int
js_start(const char *script) {
  JSValue ps;
  size_t len;
  char *src;
  ctx = JS_NewContext(rt);
  global = JS_GetGlobalObject(ctx);
  ps = JS_NewObject(ctx);
  ps_basic(ctx, ps);
  canvas_register(ctx, ps);
  core_register(ctx, ps);
  if(audio_init(ctx, ps)) say("[main] sin audio: %s\n", SDL_GetError());   // el juego sigue, sin sonido
  if(tiles_worker_init(ctx, ps, ROOT, say)) say("[main] sin hilo del suelo: se pinta en el principal\n");
  if(net_init(ctx, ps, ROOT, say)) say("[main] sin red: el juego va en local\n");
  rtc_init(ctx, ps, say);
  if(screen_id < 0) { canvas_set_font_dir(ROOT "/game/assets/fonts"); screen_id = canvas_screen(fb, FW, FH); }
  JS_SetPropertyStr(ctx, ps, "SCREEN", JS_NewInt32(ctx, screen_id));
  JS_SetPropertyStr(ctx, ps, "W", JS_NewInt32(ctx, FW));
  JS_SetPropertyStr(ctx, ps, "H", JS_NewInt32(ctx, FH));
  JS_SetPropertyStr(ctx, ps, "ROOT", JS_NewString(ctx, ROOT));
#ifdef PS5_TITLE
  {   // La partida de cada perfil de la PS5 en ROOT/user/<usuario> (como gb5); browser.js la busca ahí con ps.USER.
      // La de antes (ROOT/localStorage.json) pasa al primer perfil que abra el juego sin partida propia.
    extern int32_t title_user(void);
    int32_t u = title_user();
    if(u >= 0) {
      char id[16], dir[64], to[96];
      snprintf(id, sizeof id, "%08x", (uint32_t)u);
      snprintf(dir, sizeof dir, ROOT "/user/%s", id);
      snprintf(to, sizeof to, "%s/localStorage.json", dir);
      mkdir(ROOT "/user", 0777); mkdir(dir, 0777);
      chmod(ROOT "/user", 0777); chmod(dir, 0777);   // (el FTP, otro proceso, las lista y las copia)
      if(access(to, F_OK) != 0 && rename(ROOT "/localStorage.json", to) == 0) say("[perfil] localStorage.json: ahora del usuario %s\n", id);
      JS_SetPropertyStr(ctx, ps, "USER", JS_NewString(ctx, id));
      user_name(ctx, ps, u);
    }
  }
#endif
  JS_SetPropertyStr(ctx, ps, "LANG", JS_NewString(ctx, system_lang()));
  JS_SetPropertyStr(ctx, ps, "PAD", JS_NewString(ctx, pad ? SDL_GameControllerName(pad) : ""));
  JS_SetPropertyStr(ctx, global, "ps", ps);
  if(!(src = read_file(script, &len))) { notify("PokeSurvivor: no se encuentra " ROOT "/shim/boot.js"); return 1; }
  phase = "carga del JS";
  if(check(ctx, JS_Eval(ctx, src, len, script, JS_EVAL_TYPE_GLOBAL))) { free(src); return 1; }
  free(src);
  phase = "promesas del arranque";
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
// ---------------- jugadores 2-4: cooperativo local (native/TODOS.md) ----------------
// ponytail: sólo en Dev, de momento. Al encender otro mando (y elegir otro usuario), otra copia del juego en su hilo: su
// runtime de QuickJS, su mando, su partida (user/<usuario>) y su pantalla (fbs[i]), sin audio ni red; los hilos del suelo,
// los mismos que el 1. Todas juegan la misma partida por el canal de arriba (shim/localcoop.js); present() compone según
// ps.lc_layout. Líneas [p2] del log: ms por fotograma de cada copia, candado del dibujo, memoria.
extern SDL_GameController *title_pad_new(int32_t *who);
extern int title_pad_handle(SDL_GameController *p);
extern int32_t title_user(void);
static int32_t p_user[MAXP];
static pthread_mutex_t p_mx = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t p_go = PTHREAD_COND_INITIALIZER;
static unsigned p_gen;            // sube en cada fotograma del jugador 1: los demás hacen el suyo (sin que él los espere)
static double p_ms[MAXP];         // lo que tardó el último fotograma de cada uno
static volatile Uint64 p_last[MAXP];   // cuándo acabó (ms): si pasa mucho, está atascado

static void*
p_thread(void *arg) {
  const int me = (int)(intptr_t)arg;
  double k = 1000.0 / SDL_GetPerformanceFrequency();
  Uint64 t0 = SDL_GetPerformanceCounter();
  JSRuntime *r = JS_NewRuntime2(&JS_MF, &js_bytesp[me]);
  JS_SetGCThreshold(r, (size_t)-1);
  JS_SetMaxStackSize(r, 4 << 20);
  JS_SetHostPromiseRejectionTracker(r, on_rejection, NULL);
  JSContext *c = JS_NewContext(r);
  JS_SetContextOpaque(c, (void*)(intptr_t)me);
  JSValue g = JS_GetGlobalObject(c), ps = JS_NewObject(c), fr;
  char id[16], dir[64], *src;
  size_t len;
  snprintf(id, sizeof id, "%08x", (uint32_t)p_user[me]);
  snprintf(dir, sizeof dir, ROOT "/user/%s", id);
  mkdir(ROOT "/user", 0777); mkdir(dir, 0777); chmod(dir, 0777);
  ps_basic(c, ps);
  canvas_register(c, ps);
  { const int rc = audio_player(c, ps, me, p_user[me]); say("[p%d] sonido en su mando: %s (0x%x)\n", me + 1, rc ? "no" : "sí", rc); }
  { const int rc = audio_pad(0, title_user()); if(rc) say("[p1] sin sonido en su mando (0x%x): sigue en la tele\n", rc); }   // (el 1, también al suyo)
  if(tiles_worker_init(c, ps, ROOT, say)) say("[p%d] sin hilos del suelo: lo pinta en el suyo\n", me + 1);   // (los mismos 6 hilos)
  const int screen = canvas_screen(fbs[me], FW, FH);
  JS_SetPropertyStr(c, ps, "SCREEN", JS_NewInt32(c, screen));
  JS_SetPropertyStr(c, ps, "W", JS_NewInt32(c, FW));
  JS_SetPropertyStr(c, ps, "H", JS_NewInt32(c, FH));
  JS_SetPropertyStr(c, ps, "ROOT", JS_NewString(c, ROOT));
  JS_SetPropertyStr(c, ps, "USER", JS_NewString(c, id));
  user_name(c, ps, p_user[me]);
  JS_SetPropertyStr(c, ps, "LANG", JS_NewString(c, system_lang()));
  JS_SetPropertyStr(c, ps, "PAD", JS_NewString(c, "DualSense"));
  JS_SetPropertyStr(c, g, "ps", ps);
  canvas_multi = 1;   // desde aquí dibujan varios hilos
  if(!(src = read_file(ROOT "/shim/boot.js", &len))) { say("[p%d] no se encuentra boot.js\n", me + 1); return NULL; }
  int bad = check(c, JS_Eval(c, src, len, ROOT "/shim/boot.js", JS_EVAL_TYPE_GLOBAL));
  free(src);
  if(bad) { say("[p%d] boot.js falló: sin este jugador\n", me + 1); return NULL; }
  run_jobs(r);
  fr = JS_GetPropertyStr(c, g, "frame");
  say("[p%d] jugador %d (usuario %s) en marcha en %.0f ms: su JS %zu MB, el del jugador 1 %zu MB, proceso %ld MB\n",
      me + 1, me + 1, id, (SDL_GetPerformanceCounter() - t0) * k, js_bytesp[me] >> 20, js_bytes >> 20, mem_mb());
  unsigned seen;
  pthread_mutex_lock(&p_mx);
  seen = p_gen;
  pthread_mutex_unlock(&p_mx);
  split = 1;
  p_on[me] = 1;
  for(;;) {   // como mucho uno por cada fotograma del jugador 1 (que no le espera: si va lento, se salta alguno)
    pthread_mutex_lock(&p_mx);
    while(p_gen == seen) pthread_cond_wait(&p_go, &p_mx);
    seen = p_gen;
    pthread_mutex_unlock(&p_mx);
    Uint64 a = SDL_GetPerformanceCounter();
    const int draws = p_draws[me];
    canvas_skip[me] = draws ? -1 : screen;   // su pantalla no se ve: no se pinta (para todo el fotograma)
    JSValue now = JS_NewFloat64(c, a * k);
    check(c, JS_Call(c, fr, g, 1, &now));
    run_jobs(r);
    if(draws) { pthread_mutex_lock(&fbv_mx); memcpy(fbv[me], fbs[me], (size_t)FW * FH * 4); pthread_mutex_unlock(&fbv_mx); }
    {   // (diagnóstico) su pantalla igual fotograma tras fotograma mientras se ve: cuánto y desde cuándo
      static Uint32 last_sum[MAXP];
      static Uint64 same_since[MAXP];
      Uint32 sum = 0;
      for(int y = 8; y < FH; y += 67) for(int x = 8; x < FW; x += 71) sum = sum * 31 + fbs[me][y * FW + x];
      const Uint64 t = SDL_GetTicks64();
      if(!draws || sum != last_sum[me]) {
        if(same_since[me] && t - same_since[me] > 400) say("[p%d] su pantalla volvió a cambiar tras %.1f s igual\n", me + 1, (t - same_since[me]) / 1000.0);
        same_since[me] = draws ? t : 0;
      }
      last_sum[me] = sum;
    }
    p_ms[me] = (SDL_GetPerformanceCounter() - a) * k;
    p_last[me] = SDL_GetTicks64();
  }
  return NULL;
}

// Mandos de otros usuarios con sesión en la PS5: cada segundo se abre el de uno nuevo (en espera); su copia del juego sólo
// arranca cuando pulsa ✕, en la primera plaza libre. Un usuario con sesión pero sin mando no ocupa plaza (con 4 sesiones y
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
    if(core_pads) { say("[núcleo] el jugador %d juega en esta copia\n", me + 1); continue; }
    pthread_attr_t at;
    pthread_t t;
    if(!(fbs[me] = calloc((size_t)FW * FH, 4)) || !(fbv[me] = calloc((size_t)FW * FH, 4))) { say("[p%d] sin memoria para su pantalla\n", me + 1); return; }
    pthread_attr_init(&at);
    pthread_attr_setstacksize(&at, 64u << 20);   // como el hilo del juego (QuickJS cree tener 4 MB)
    if(pthread_create(&t, &at, p_thread, (void*)(intptr_t)me)) say("[p%d] no se pudo crear su hilo\n", me + 1);
  }
  if(now - last < 1000) return;
  last = now;
  int w = 0;
  while(w < MAXP && waiting[w]) w++;
  if(w < MAXP && (waiting[w] = title_pad_new(&waiting_user[w])))
    say("[local] mando de otro usuario (%08x, mando %d): en espera de su ✕\n", (uint32_t)waiting_user[w], title_pad_handle(waiting[w]));
}
#endif

// Una sola copia del juego: si se abre otra vez desde el lanzador sin haber salido (Create 2 s), la vieja seguía
// corriendo sin pantalla, con su música. Cada copia escucha en un puerto local; la nueva le manda "salir"
// (guarda y termina, y suelta la pantalla) y espera a quedarse con el puerto.
#define ONE_PORT 9173
static int one_fd = -1;

static void
take_over(void) {
#ifdef PS5_TITLE
  return;   // un título sólo se abre una vez: la consola ya lo controla
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
  char b[8];
  return one_fd >= 0 && recv(one_fd, b, sizeof b, 0) > 0;
}

#ifdef PS5_TITLE
#define main game_main   // (el main del título está al final: lo lanza en un hilo con pila grande)
#endif
int
main(int argc, char **argv) {
  const char *script = argc > 1 ? argv[1] : ROOT "/shim/boot.js";
  Uint64 create_down = 0;
  int quit = 0;

  // Todo lo que se escribe va a LOG (make -C native log).
  // freopen no reutiliza el descriptor 2 en esta libc: los dos (1 y 2) se apuntan al log a mano.
  if(freopen(LOG, "w", stderr)) {
    int fd = fileno(stderr);
    dup2(fd, 1);
    if(fd != 2) dup2(fd, 2);
    setvbuf(stderr, NULL, _IONBF, 0);
    setvbuf(stdout, NULL, _IONBF, 0);
  }

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
  }
#else
  signal(SIGSEGV, on_crash); signal(SIGBUS, on_crash); signal(SIGILL, on_crash);
  signal(SIGFPE, on_crash); signal(SIGABRT, on_crash);
#endif

  if(SDL_Init(SDL_INIT_GAMECONTROLLER | SDL_INIT_AUDIO)) {
    notify(SDL_GetError());
    return 1;
  }
  for(int i = 0; i < SDL_NumJoysticks() && !pad; i++)
    if(SDL_IsGameController(i)) pad = SDL_GameControllerOpen(i);
  if(video_init()) {
    char buf[256];
    snprintf(buf, sizeof buf, "PokeSurvivor: sin pantalla (%s)", SDL_GetError());
    say("%s\n", buf);
    log_flush();
    notify(buf);
    _exit(1);   // salir de main con hilos vivos (SDL) acababa en señal 11
  }

  rt = JS_NewRuntime2(&JS_MF, NULL);
  JS_SetGCThreshold(rt, (size_t)-1);   // sin recolector automático: lo lanza browser.js (ps.gc)
  JS_SetMaxStackSize(rt, 4 << 20);
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

    while(SDL_PollEvent(&ev)) {
      if(ev.type == SDL_QUIT) quit = 1;
      if(ev.type == SDL_CONTROLLERDEVICEADDED && !pad) pad = SDL_GameControllerOpen(ev.cdevice.which);
    }
    now = SDL_GetTicks64();
    arg = JS_NewFloat64(ctx, SDL_GetPerformanceCounter() * 1000.0 / SDL_GetPerformanceFrequency());
    // ponytail: un error en un fotograma no cierra el juego; se avisa y se sigue (como el navegador).
    Uint64 f0 = SDL_GetPerformanceCounter(), f1, f2;
    unsigned long loads0 = canvas_loads, calls0 = canvas_calls;
    if(frames < 3) dsay("[fotograma %lu] JS… (%lu llamadas de dibujo, %ld MB)\n", frames, canvas_calls, mem_mb());
#if defined(PS5_TITLE) && defined(PS5_DEV)
    p_poll(now);
    if(split) { pthread_mutex_lock(&p_mx); p_gen++; pthread_cond_broadcast(&p_go); pthread_mutex_unlock(&p_mx); }   // los suyos, a la vez
#endif
    phase = "frame (JS)";
    check(ctx, JS_Call(ctx, frame, global, 1, &arg));
    if(frames < 3) dsay("[fotograma %lu] promesas… (%lu llamadas de dibujo, %ld MB)\n", frames, canvas_calls, mem_mb());
    phase = "promesas";
    run_jobs(rt);
    if(frames < 3) dsay("[fotograma %lu] presentar…\n", frames);
#if defined(PS5_TITLE) && defined(PS5_DEV)
#endif
    f1 = SDL_GetPerformanceCounter();
    phase = "presentar";
    present();
    f2 = SDL_GetPerformanceCounter();
    frames++;
    {
      // Los fotogramas lentos (más de 25 ms sin contar la espera al vblank), con su motivo probable.
      double k = 1000.0 / SDL_GetPerformanceFrequency(), js = (f1 - f0) * k, total = (f2 - f0) * k - wait_ms;
      static double work_sum, work_max, beat;
      static unsigned long beat_frames, missed;
      work_sum += total; if(total > work_max) work_max = total;
#if defined(PS5_TITLE) && defined(PS5_DEV)
      static double p_sum[MAXP], p_max[MAXP];
      static unsigned long long tsc0;
      for(int i = 1; i < MAXP; i++) if(p_on[i]) { p_sum[i] += p_ms[i]; if(p_ms[i] > p_max[i]) p_max[i] = p_ms[i]; }
      if((f2 * k) - beat > 5000 && beat && split) {
        unsigned long long tsc = __builtin_ia32_rdtsc();
        double cyc_ms = tsc0 ? (tsc - tsc0) / ((f2 * k) - beat) : 0;
        char buf[400];
        int len = 0;
        for(int i = 1; i < MAXP; i++)
          if(p_on[i]) len += snprintf(buf + len, sizeof buf - len, "jugador %d %.1f ms de media (máx %.1f, JS %zu MB, %s) · ", i + 1,
                                      p_sum[i] / (beat_frames + 1), p_max[i], js_bytesp[i] >> 20, p_draws[i] ? "pinta" : "no pinta");
        say("[p2] %lu fotogramas: %scandado del dibujo %.1f ms por fotograma; JS del 1 %zu MB; proceso %ld MB\n", beat_frames + 1, buf,
            cyc_ms > 0 ? canvas_wait_cyc / cyc_ms / (beat_frames + 1) : 0, js_bytes >> 20, mem_mb());
        memset(p_sum, 0, sizeof p_sum); memset(p_max, 0, sizeof p_max); canvas_wait_cyc = 0;
        for(int i = 1; i < MAXP; i++)   // una copia que no acaba su fotograma (un bucle sin fin en su JS, un candado…)
          if(p_on[i] && p_last[i] && SDL_GetTicks64() - p_last[i] > 2000)
            say("[p%d] atascado: su último fotograma acabó hace %.1f s\n", i + 1, (SDL_GetTicks64() - p_last[i]) / 1000.0);
      }
      if((f2 * k) - beat > 5000) tsc0 = __builtin_ia32_rdtsc();
#endif
      if(total > 16.6) missed++;
      beat_frames++;
      if((f2 * k) - beat > 5000) {
        if(beat) dsay("[ritmo] %lu fotogramas: trabajo medio %.1f ms, máximo %.1f ms, %lu se pasaron de 16,7 ms (copiar %.1f ms)\n",
                     beat_frames, work_sum / beat_frames, work_max, missed, copy_ms);
        canvas_prof(say, beat ? beat_frames : 0);
        beat = f2 * k; work_sum = work_max = 0; beat_frames = missed = 0;
      }
      if(frames > 5 && total > 25)
        dsay("[lento] fotograma %lu: %.0f ms (JS+dibujo %.0f, copiar %.0f), %lu imágenes cargadas, %lu llamadas de dibujo, %ld MB\n",
            frames, total, js, copy_ms, canvas_loads - loads0, canvas_calls - calls0, mem_mb());
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
  SDL_Quit();
  sceVideoOutClose(vout);
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
