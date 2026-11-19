/* sdl_title.c — lo poco de SDL2 que usa el motor (ver include/SDL2/SDL.h), con las llamadas de la consola
 * para un título: mando con scePad, sonido con un hilo y sceAudioOut, relojes con clock_gettime.
 * Las llamadas y la muestra de 120 bytes del mando son las de PS5_VulkanTemplate (ps5/src/platform.c).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <SDL2/SDL.h>

#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

int sceKernelUsleep(uint32_t us);
int sceUserServiceInitialize(const void *params);
int sceUserServiceGetInitialUser(int32_t *user_id);
int sceUserServiceGetLoginUserIdList(int32_t ids[4]);   // -1 = hueco libre
int scePadInit(void);
int scePadOpen(int32_t user_id, int32_t type, int32_t index, const void *params);
int scePadRead(int32_t handle, void *samples, int32_t count);
int scePadSetVibrationMode(int32_t handle, int32_t mode);
int scePadSetVibration(int32_t handle, const void *vibration);
int sceAudioOutInit(void);
int sceAudioOutOpen(int32_t user, int32_t type, int32_t index, uint32_t grain, uint32_t rate, uint32_t format);
int sceAudioOutOutput(int32_t port, const void *samples);

static char err[256];
int
SDL_SetError(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt); vsnprintf(err, sizeof err, fmt, ap); va_end(ap);
  return -1;
}
const char *SDL_GetError(void) { return err; }

Uint64
SDL_GetPerformanceCounter(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (Uint64)t.tv_sec * 1000000000u + (Uint64)t.tv_nsec;
}
Uint64 SDL_GetPerformanceFrequency(void) { return 1000000000u; }
Uint64 SDL_GetTicks64(void) { return SDL_GetPerformanceCounter() / 1000000u; }
void SDL_Delay(Uint32 ms) { sceKernelUsleep(ms * 1000u); }

// ---------------- mando ----------------
// La muestra que escribe la consola (120 bytes): botones, palancas 0..255 (128 en reposo), gatillos 0..255.
struct pad_sample {
  uint32_t buttons;
  uint8_t lx, ly, rx, ry, l2, r2;
  uint8_t reserved[66];
  int32_t connected;
  uint8_t rest[40];
};
_Static_assert(sizeof(struct pad_sample) == 120, "muestras de 120 bytes");
_Static_assert(offsetof(struct pad_sample, connected) == 0x4c, "conectado en 0x4c");

struct SDL_GameController { int32_t handle; struct pad_sample s; Uint64 read_at, rumble_until; };
static struct SDL_GameController the_pad = { .handle = -1 };
static int32_t user = -1;
int32_t title_user(void) { return user; }   // quien abrió el juego (main.c: su partida)
static int added;   // el "mando conectado" se da una vez, en el primer SDL_PollEvent

// Botón de SDL -> bit de scePad. El de Crear no lo da scePad: BACK es el panel táctil.
static const uint32_t BIT[SDL_CONTROLLER_BUTTON_MAX] = {
  [SDL_CONTROLLER_BUTTON_A] = 0x4000, [SDL_CONTROLLER_BUTTON_B] = 0x2000, [SDL_CONTROLLER_BUTTON_X] = 0x8000,
  [SDL_CONTROLLER_BUTTON_Y] = 0x1000, [SDL_CONTROLLER_BUTTON_BACK] = 0x100000, [SDL_CONTROLLER_BUTTON_START] = 0x8,
  [SDL_CONTROLLER_BUTTON_LEFTSTICK] = 0x2, [SDL_CONTROLLER_BUTTON_RIGHTSTICK] = 0x4,
  [SDL_CONTROLLER_BUTTON_LEFTSHOULDER] = 0x400, [SDL_CONTROLLER_BUTTON_RIGHTSHOULDER] = 0x800,
  [SDL_CONTROLLER_BUTTON_DPAD_UP] = 0x10, [SDL_CONTROLLER_BUTTON_DPAD_DOWN] = 0x40,
  [SDL_CONTROLLER_BUTTON_DPAD_LEFT] = 0x80, [SDL_CONTROLLER_BUTTON_DPAD_RIGHT] = 0x20,
  [SDL_CONTROLLER_BUTTON_TOUCHPAD] = 0x100000,
};

// Una lectura por fotograma como mucho (main.c pregunta por cada botón y cada eje): la última muestra.
static void
refresh(SDL_GameController *p) {
  Uint64 now = SDL_GetTicks64();
  if(p->handle < 0 || now - p->read_at < 2) return;
  p->read_at = now;
  struct pad_sample s[16];
  int n = scePadRead(p->handle, s, 16);
  if(n > 0) p->s = s[n - 1];
  if(p->rumble_until && now >= p->rumble_until) {
    uint8_t off[2] = { 0, 0 };
    scePadSetVibration(p->handle, off);
    p->rumble_until = 0;
  }
}

int
SDL_Init(Uint32 flags) {
  if(flags & SDL_INIT_GAMECONTROLLER) {
    sceUserServiceInitialize(NULL);
    sceUserServiceGetInitialUser(&user);
    scePadInit();
    if((the_pad.handle = scePadOpen(user, 0, 0, NULL)) < 0) the_pad.handle = -1;
    else scePadSetVibrationMode(the_pad.handle, 2);   // dos motores, como PS5_vkQuake
    memset(&the_pad.s, 0, sizeof the_pad.s);
    the_pad.s.lx = the_pad.s.ly = the_pad.s.rx = the_pad.s.ry = 128;
  }
  return 0;   // (el sonido se abre en SDL_OpenAudioDevice)
}
void SDL_Quit(void) {}

int SDL_NumJoysticks(void) { return the_pad.handle >= 0; }
SDL_bool SDL_IsGameController(int i) { return i == 0 && the_pad.handle >= 0 ? SDL_TRUE : SDL_FALSE; }
SDL_GameController *SDL_GameControllerOpen(int i) { return i == 0 && the_pad.handle >= 0 ? &the_pad : NULL; }
const char *SDL_GameControllerName(SDL_GameController *p) { return p ? "DualSense" : ""; }

int
SDL_PollEvent(SDL_Event *ev) {
  if(added || the_pad.handle < 0) return 0;
  added = 1;
  memset(ev, 0, sizeof *ev);
  ev->type = SDL_CONTROLLERDEVICEADDED;
  return 1;
}

int title_pad_handle(SDL_GameController *p) { return p ? p->handle : -1; }   // (diagnóstico de main.c)

// Jugadores 2-4 (main.c, cooperativo local): el mando de otro usuario con sesión en la PS5 que aún no juega (al encender
// otro mando, la consola pregunta quién lo usa), como gb5. NULL si no hay ninguno nuevo.
static struct SDL_GameController more_pads[3] = { { .handle = -1 }, { .handle = -1 }, { .handle = -1 } };
static int32_t more_users[3] = { -1, -1, -1 };
SDL_GameController *
title_pad_new(int32_t *who) {
  int slot = 0;
  while(slot < 3 && more_pads[slot].handle >= 0) slot++;
  if(slot >= 3) return NULL;
  int32_t ids[4] = { -1, -1, -1, -1 };
  sceUserServiceGetLoginUserIdList(ids);
  for(int i = 0; i < 4; i++) {
    if(ids[i] == -1 || ids[i] == user || ids[i] == more_users[0] || ids[i] == more_users[1] || ids[i] == more_users[2]) continue;
    int h = scePadOpen(ids[i], 0, 0, NULL);
    if(h < 0) continue;
    SDL_GameController *p = &more_pads[slot];
    scePadSetVibrationMode(h, 2);
    memset(&p->s, 0, sizeof p->s);
    p->s.lx = p->s.ly = p->s.rx = p->s.ry = 128;
    p->handle = h;
    more_users[slot] = *who = ids[i];
    return p;
  }
  return NULL;
}

Uint8
SDL_GameControllerGetButton(SDL_GameController *p, SDL_GameControllerButton b) {
  if(!p || b < 0 || b >= SDL_CONTROLLER_BUTTON_MAX || !BIT[b]) return 0;
  refresh(p);
  return !!(p->s.buttons & BIT[b]);
}

Sint16
SDL_GameControllerGetAxis(SDL_GameController *p, SDL_GameControllerAxis a) {
  if(!p) return 0;
  refresh(p);
  const uint8_t v[] = { p->s.lx, p->s.ly, p->s.rx, p->s.ry, p->s.l2, p->s.r2 };
  if(a < 0 || a > SDL_CONTROLLER_AXIS_TRIGGERRIGHT) return 0;
  if(a >= SDL_CONTROLLER_AXIS_TRIGGERLEFT) return (Sint16)(v[a] * 32767 / 255);
  int x = ((int)v[a] - 128) * 256;
  return (Sint16)(x > 32767 ? 32767 : x);
}

int
SDL_GameControllerRumble(SDL_GameController *p, Uint16 lo, Uint16 hi, Uint32 ms) {
  if(!p || p->handle < 0) return -1;
  uint8_t vib[2] = { (uint8_t)(lo >> 8), (uint8_t)(hi >> 8) };   // grande, pequeño
  p->rumble_until = (lo || hi) ? SDL_GetTicks64() + (ms ? ms : 1) : 0;
  return scePadSetVibration(p->handle, vib) < 0 ? -1 : 0;
}

// ---------------- sonido ----------------
#define GRAIN 256   // fotogramas por bloque: 5,3 ms a 48 kHz
static pthread_mutex_t audio_mx = PTHREAD_MUTEX_INITIALIZER;
static SDL_AudioSpec spec;
static int32_t port = -1;
static volatile int paused = 1;

static void*
audio_thread(void *arg) {
  static float f[GRAIN * 2];
  static int16_t s[GRAIN * 2] __attribute__((aligned(64)));
  (void)arg;
  for(;;) {
    if(paused) memset(f, 0, sizeof f);
    else {
      pthread_mutex_lock(&audio_mx);
      spec.callback(spec.userdata, (Uint8*)f, (int)sizeof f);
      pthread_mutex_unlock(&audio_mx);
    }
    for(int i = 0; i < GRAIN * 2; i++) {
      float v = f[i] * 32767.0f;
      s[i] = (int16_t)(v > 32767.0f ? 32767 : v < -32768.0f ? -32768 : v);
    }
    if(sceAudioOutOutput(port, s) < 0) sceKernelUsleep(5000);   // marca el ritmo: espera un bloque
  }
  return NULL;
}

SDL_AudioDeviceID
SDL_OpenAudioDevice(const char *name, int capture, const SDL_AudioSpec *want, SDL_AudioSpec *have, int changes) {
  (void)name; (void)capture; (void)changes;
  if(port >= 0 || !want || !want->callback || want->channels != 2) return SDL_SetError("audio: ya abierto o formato raro"), 0;
  sceAudioOutInit();   // (si ya estaba iniciado, devuelve un error que no importa)
  if((port = sceAudioOutOpen(0xff, 0, 0, GRAIN, 48000, 1)) < 0) { SDL_SetError("sceAudioOutOpen 0x%x", port); port = -1; return 0; }
  spec = *want;
  spec.freq = 48000; spec.samples = GRAIN;
  if(have) *have = spec;
  pthread_t t;
  if(pthread_create(&t, NULL, audio_thread, NULL)) return SDL_SetError("audio: sin hilo"), 0;
  return 1;
}
void SDL_PauseAudioDevice(SDL_AudioDeviceID dev, int pause) { (void)dev; paused = pause; }
void SDL_LockAudioDevice(SDL_AudioDeviceID dev) { (void)dev; pthread_mutex_lock(&audio_mx); }
void SDL_UnlockAudioDevice(SDL_AudioDeviceID dev) { (void)dev; pthread_mutex_unlock(&audio_mx); }
