/* La plataforma PS5 (ver platform.h): VideoOut, el aviso de la consola, su idioma y el nombre del perfil.
 * Lo demás (mando, audio de la tele, relojes) ya va por SDL2: el de ps5-payload-dev o el mínimo de title/sdl.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <SDL2/SDL.h>
#include "gpu.h"
#include "platform.h"

void gpu_vk_close(void);   // (gpu_vk.c: suelta la pantalla)

#define W 1920   // la salida; la pantalla del juego (fb) es la mitad y se escala ×2
#define H 1080
#define FW 960   // ponytail: la PS5 dibuja siempre a 960x540 (lo que no va por la GPU sigue en PlutoVG) y lo escala ×2
#define FH 540

#ifdef PS5_TITLE
// Un título sale pidiéndoselo a la consola (exit/_exit cuentan como cierre por error). El CRT llama a esto al volver de main.
int sceSystemServiceLoadExec(const char *path, const char *const *argv);
int sceKernelUsleep(unsigned us);
void catchReturnFromMain(int status) {
  (void)status;
  sceSystemServiceLoadExec("exit", NULL);
  for(;;) sceKernelUsleep(100000);
}
#endif

static const Uint32 *fb;
double plat_copy_ms, plat_wait_ms;

typedef struct notify_request {
  char useless1[45];
  char message[3075];
} notify_request_t;
int sceKernelSendNotificationRequest(int, notify_request_t*, size_t, int);

void
plat_notify(const char *msg) {
#ifdef PS5_TITLE
  fprintf(stderr, "[aviso] %s\n", msg);   // ponytail: el aviso de la consola es de libkernel_sys, que un título no tiene
#else
  notify_request_t req;
  memset(&req, 0, sizeof req);
  snprintf(req.message, sizeof req.message, "%s", msg);
  sceKernelSendNotificationRequest(0, &req, sizeof req, 0);
#endif
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
const char*
plat_lang(void) {
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

void plat_screen_size(int *w, int *h) { *w = FW; *h = FH; }

int
plat_video_init(const Uint32 *screen, int w, int h) {
  if(w != FW || h != FH) return SDL_SetError("la PS5 sólo dibuja a %dx%d", FW, FH);
  if(!gpu_open(NULL, w, h)) return 0;   // el título: Vulkan (gpu_vk.c), y VideoOut es suyo. Si no arranca, lo de siempre
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
  fb = screen;
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
  for(int b = first; b < last; b++) {
    int by = b / VBLOCKS_X, bx = b % VBLOCKS_X;
    Uint32 *out = copy_out + (size_t)b * 128 * 128;
    for(int i = 0; i < 128 * 128; i++) {
      int v = untile[i], y = by * 128 + (v >> 7), x = bx * 128 + (v & 127);
      const Uint32 p = y >= H ? 0 : fb[(y >> 1) * FW + (x >> 1)];   // ×2 al píxel más cercano
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

void
plat_present(void) {
  if(gpu_on) { gpu_present(NULL, &plat_copy_ms, &plat_wait_ms); return; }
  double f = 1000.0 / SDL_GetPerformanceFrequency();
  Uint64 t0 = SDL_GetPerformanceCounter(), t1;
  const int target = (vlast + 1) % VBUFS;   // ni en pantalla ni en cola

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
  t1 = SDL_GetPerformanceCounter();
  // Nunca dos cambios en cola: se espera al anterior (esto es el vsync).
  for(int spins = 0; sceVideoOutIsFlipPending(vout) > 0 && spins < 4; spins++) sceVideoOutWaitVblank(vout);
  sceVideoOutSubmitFlip(vout, target, 1, vflips++);
  vlast = target;
  plat_copy_ms = (t1 - t0) * f;
  plat_wait_ms = (SDL_GetPerformanceCounter() - t1) * f;
}

void
plat_video_close(void) {
  if(gpu_on) { gpu_vk_close(); return; }
  sceVideoOutClose(vout);
}

#ifdef PS5_TITLE
int sceUserServiceGetUserName(int32_t user, char *name, size_t size);
int
plat_user_name(int32_t user, char *name, size_t len) {
  if(len < 17) return -1;
  name[0] = 0;
  return sceUserServiceGetUserName(user, name, 17) == 0 && name[0] ? 0 : -1;
}
#else
int
plat_user_name(int32_t user, char *name, size_t len) { (void)user; (void)name; (void)len; return -1; }
#endif

const char PLAT_NAME[] = "ps5";
const char *plat_pad_type(SDL_GameController *pad) { (void)pad; return "ps"; }   // (el DualSense)

// Todo en la carpeta del juego (se lee y se escribe): la del título (/app0 = /data/homebrew/<titleId>) o la del payload.
#ifdef PS5_TITLE
#define ROOT "/app0"
#else
#define ROOT "/data/homebrew/PokeSurvivorNative"
#endif
const char *plat_root(void) { return ROOT; }
const char *plat_data(void) { return ROOT; }

// @step nupdate/relaunch
void plat_relaunch(char **argv) { (void)argv; }   // (la PS5 no cambia de resolución: nunca se pide)

void plat_mouse(int *x, int *y) { (void)x; (void)y; }   // (la PS5 no tiene ratón)
int plat_text_input(const char *title, const char *init, int max, int mask, char *out, size_t n) {   // (ui.js usa su teclado)
  (void)title; (void)init; (void)max; (void)mask; (void)out; (void)n;
  return -1;
}
void plat_pad_adjust(SDL_GameController *pad, int *b, double ax[6]) { (void)pad; (void)b; (void)ax; }   // (sólo Switch: el Joy-Con suelto)
int plat_pad_setup(int maxp, int single) { (void)maxp; (void)single; return -1; }   // (sólo Switch tiene el applet de mandos)


int
plat_pick_file(void) { return 0; }   // (sólo Android)

void
plat_keep_alive(int on) { (void)on; }   // (sólo Android)

int
plat_has_keyboard(void) { return 0; }   // (ui.js usa su teclado o el del sistema; ps.has_keyboard es de escritorio)
