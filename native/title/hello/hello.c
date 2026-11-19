/* hello.c — paso 1 del título de PS5 (ver native/TITLE.md): lo mínimo de nuestro motor dentro de un
 * título PPSA en vez de un payload. Abre la pantalla con sceVideoOut (lo de main.c, sin SDL), dibuja con
 * PlutoVG (un rectángulo que se mueve y texto con la fuente del juego, desde /app0) y lee el mando con
 * scePad. ✕ o 60 s: sale pidiéndoselo a la consola (exit() cuenta como fallo en un título).
 * Deja /app0/log.txt (= /data/homebrew/PPSA77701/log.txt).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <plutovg.h>

#include <pthread.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>

int sceSystemServiceHideSplashScreen(void);
int sceSystemServiceLoadExec(const char *path, const char *const *argv);
int sceKernelUsleep(uint32_t us);
int sceUserServiceInitialize(const void *params);
int sceUserServiceGetInitialUser(int32_t *user_id);
int scePadInit(void);
int scePadOpen(int32_t user_id, int32_t type, int32_t index, const void *params);
int scePadRead(int32_t handle, void *samples, int32_t count);

typedef struct { void *data, *metadata, *reserved0, *reserved1; } VideoBuffer;
typedef struct { uint8_t reserved[80]; } VideoAttribute;
int sceVideoOutOpen(int user_id, int bus_type, int index, const void *param);
int sceVideoOutSetFlipRate(int handle, int rate);
void sceVideoOutSetBufferAttribute2(VideoAttribute *attr, uint64_t pixel_format, uint32_t tiling_mode, uint32_t width,
                                    uint32_t height, uint64_t option, uint32_t dcc_control, uint64_t dcc_clear_color);
int sceVideoOutRegisterBuffers2(int handle, int set_index, int buffer_index_start, VideoBuffer *buffers, int buffer_count,
                                VideoAttribute *attr, int category, void *option);
int sceVideoOutSubmitFlip(int handle, int buffer_index, uint32_t flip_mode, int64_t flip_arg);
int sceVideoOutIsFlipPending(int handle);
int sceVideoOutWaitVblank(int handle);
int sceKernelAllocateMainDirectMemory(size_t len, size_t align, int type, int64_t *phys);
int sceKernelMapDirectMemory(void **addr, size_t len, int prot, int flags, int64_t phys, size_t align);

#define W 1920
#define H 1080
#define FW (W / 2)                  // se dibuja a media resolución y se escala ×2, como el juego
#define FH (H / 2)
#define VBUFS 3
#define VFRAME 0x1000000u
#define VBLOCKS_X (W / 128)
#define VBLOCKS_Y ((H + 127) / 128)
#define PAD_CROSS 0x4000u

static FILE *logfile;
static void
say(const char *fmt, ...) {
  va_list ap;
  if(!logfile) return;
  va_start(ap, fmt); vfprintf(logfile, fmt, ap); va_end(ap);
  fputc('\n', logfile); fflush(logfile);
}

static double
now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }

// La salida de un título: se le pide a la consola y se espera (el CRT llama a esto al volver de main).
void
catchReturnFromMain(int status) {
  say("salida %d", status);
  if(logfile) fclose(logfile), logfile = NULL;
  sceSystemServiceLoadExec("exit", NULL);
  for(;;) sceKernelUsleep(100000);
}

// ---------------- pantalla (igual que native/main.c) ----------------
static uint32_t *fb, *vframes[VBUFS];
static uint16_t untile[128 * 128];
static int vout = -1, vlast;
static int64_t vflips = 1;

static int
video_init(void) {
  int64_t phys = 0;
  void *mem = NULL;
  VideoBuffer bufs[VBUFS];
  VideoAttribute attr;
  int rc;
  for(uint32_t y = 0; y < 128; y++) {
    uint32_t row = ((y << 4) & 0x70u) ^ ((y << 5) & 0xf00u) ^ ((y << 9) & 0x1000u) ^ ((y << 8) & 0x4000u);
    for(uint32_t x = 0; x < 128; x++) {
      uint32_t col = ((x << 2) & 0xcu) ^ ((x << 5) & 0x380u) ^ ((x << 4) & 0x400u) ^ ((x << 6) & 0x800u) ^ ((x << 9) & 0xa000u);
      untile[(row ^ col) >> 2] = (uint16_t)(y << 7 | x);
    }
  }
  if(!(fb = calloc((size_t)FW * FH, 4))) return say("sin memoria"), -1;
  if((vout = sceVideoOutOpen(0xff, 0, 0, NULL)) < 0) return say("sceVideoOutOpen 0x%x", vout), -1;
  if((rc = sceKernelAllocateMainDirectMemory(VFRAME * VBUFS, 0x200000, 3, &phys))) return say("AllocateMainDirectMemory 0x%x", rc), -1;
  if((rc = sceKernelMapDirectMemory(&mem, VFRAME * VBUFS, 0x33, 0, phys, 0x200000))) return say("MapDirectMemory 0x%x", rc), -1;
  memset(mem, 0, VFRAME * VBUFS);
  for(int i = 0; i < VBUFS; i++) {
    vframes[i] = (uint32_t*)((uint8_t*)mem + (size_t)i * VFRAME);
    bufs[i] = (VideoBuffer){ vframes[i], NULL, NULL, NULL };
  }
  memset(&attr, 0, sizeof attr);
  sceVideoOutSetFlipRate(vout, 0);
  sceVideoOutSetBufferAttribute2(&attr, 0x8000000022000000ull, 0, W, H, 0, 0, 0);
  if((rc = sceVideoOutRegisterBuffers2(vout, 0, 0, bufs, VBUFS, &attr, 0, NULL))) return say("RegisterBuffers2 0x%x", rc), -1;
  sceVideoOutSubmitFlip(vout, 0, 1, vflips++);
  return 0;
}

static void
present(void) {
  const int target = (vlast + 1) % VBUFS;
  uint32_t *dst = vframes[target];
  for(int b = 0; b < VBLOCKS_X * VBLOCKS_Y; b++) {
    int by = b / VBLOCKS_X, bx = b % VBLOCKS_X;
    uint32_t *out = dst + (size_t)b * 128 * 128;
    for(int i = 0; i < 128 * 128; i++) {
      int v = untile[i], y = by * 128 + (v >> 7), x = bx * 128 + (v & 127);
      uint32_t p = y < H ? fb[(y >> 1) * FW + (x >> 1)] : 0;
      out[i] = 0xff000000 | (p & 0x00ff00) | (p >> 16 & 0xff) | (p & 0xff) << 16;
    }
  }
  __asm__ volatile("sfence" ::: "memory");
  for(int spins = 0; sceVideoOutIsFlipPending(vout) > 0 && spins < 4; spins++) sceVideoOutWaitVblank(vout);
  sceVideoOutSubmitFlip(vout, target, 1, vflips++);
  vlast = target;
}

// ---------------- mando ----------------
struct pad_sample { uint32_t buttons; uint8_t rest[116]; };
_Static_assert(sizeof(struct pad_sample) == 120, "muestras de 120 bytes");

int
main(void) {
  logfile = fopen("/app0/log.txt", "w");
  say("[título] arranca");
  say("splash: %d", sceSystemServiceHideSplashScreen());
  if(video_init()) return 1;
  say("pantalla 0x%x", vout);

  int32_t user = -1, pad = -1;
  sceUserServiceInitialize(NULL);
  sceUserServiceGetInitialUser(&user);
  scePadInit();
  pad = scePadOpen(user, 0, 0, NULL);
  say("usuario %d, mando %d", user, pad);

  plutovg_surface_t *surf = plutovg_surface_create_for_data((unsigned char*)fb, FW, FH, FW * 4);
  plutovg_canvas_t *cv = plutovg_canvas_create(surf);
  plutovg_font_face_t *font = plutovg_font_face_load_from_file("/app0/assets/PixelifyPS-700.ttf", 0);
  say("fuente %s", font ? "sí" : "NO");

  const double t0 = now();
  int frames = 0;
  double slow = 0;
  for(;;) {
    const double t = now() - t0, f0 = now();
    plutovg_canvas_set_rgb(cv, 0.06, 0.09, 0.2);
    plutovg_canvas_fill_rect(cv, 0, 0, FW, FH);
    plutovg_canvas_set_rgb(cv, 1.0, 0.82, 0.25);
    plutovg_canvas_fill_rect(cv, 40 + (FW - 160) * (0.5 + 0.5 * sin(t * 2)), 380, 80, 80);
    if(font) {
      char line[96];
      plutovg_canvas_set_font(cv, font, 48);
      plutovg_canvas_fill_text(cv, "PokéSurvivor Classic", -1, PLUTOVG_TEXT_ENCODING_UTF8, 60, 120);
      plutovg_canvas_set_rgb(cv, 1, 1, 1);
      plutovg_canvas_set_font(cv, font, 20);
      plutovg_canvas_fill_text(cv, "Paso 1: título PPSA77701 con nuestro motor (sceVideoOut + PlutoVG)", -1,
                               PLUTOVG_TEXT_ENCODING_UTF8, 60, 180);
      snprintf(line, sizeof line, "%.1f s · %d fotogramas · pulsa X para salir", t, frames);
      plutovg_canvas_fill_text(cv, line, -1, PLUTOVG_TEXT_ENCODING_UTF8, 60, 220);
    }
    present();
    frames++;
    if(now() - f0 > slow) slow = now() - f0;
    struct pad_sample s[8];
    int n = pad >= 0 ? scePadRead(pad, s, 8) : 0;
    int cross = 0;
    for(int i = 0; i < n; i++) cross |= !!(s[i].buttons & PAD_CROSS);
    if(cross || t > 60) { say("fin: %s, %d fotogramas, el más lento %.1f ms", cross ? "X" : "60 s", frames, slow * 1000); break; }
  }
  return 0;
}
