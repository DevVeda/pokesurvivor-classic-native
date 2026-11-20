/* La plataforma Switch (homebrew con libnx; ver platform.h y SWITCH.md): SDL2 de devkitPro (ventana, mandos, audio),
 * el juego en romfs: y lo que se escribe en sdmc:/switch/pokesurvivor.
 * Propio de Switch: Joy-Con sueltos (uno por jugador, de lado) o en pareja, con el applet de mandos del sistema.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <switch.h>
#include <SDL2/SDL.h>
#include "platform.h"
#include "gpu.h"

double plat_copy_ms, plat_wait_ms;
static void pad_mapping(void);
static const Uint32 *fb;
static SDL_Window *win;
static SDL_Renderer *ren;
static SDL_Texture *tex;
static int fw, fh;

// La pantalla la pinta la GPU (gpu.c): 1920x1080 en la base y 1280x720 en portátil, la del arranque (al cambiar luego,
// la GPU la escala). Con un archivo sdmc:/switch/pokesurvivor/cpu.txt: siempre 1280x720 y por PlutoVG (para comparar).
static int
want_gpu(void) { FILE *f = fopen("sdmc:/switch/pokesurvivor/cpu.txt", "r"); if(f) fclose(f); return !f; }

void
plat_screen_size(int *w, int *h) {
  const int dock = want_gpu() && appletGetOperationMode() == AppletOperationMode_Console;
  *w = dock ? 1920 : 1280; *h = dock ? 1080 : 720;
}

int
plat_video_init(const Uint32 *screen, int w, int h) {
  fb = screen; fw = w; fh = h;
  if(SDL_InitSubSystem(SDL_INIT_VIDEO)) return -1;
  SDL_SetHint(SDL_HINT_TOUCH_MOUSE_EVENTS, "0");   // (la pantalla en portátil: cada dedo al JS, como en Android; main.c)
  if(!(win = SDL_CreateWindow("PokéSurvivor Classic Native", 0, 0, 1920, 1080, SDL_WINDOW_FULLSCREEN | SDL_WINDOW_OPENGL))) return -1;
  if(want_gpu() && !gpu_open(win, w, h)) goto ready;
  fprintf(stderr, "[switch] sin GPU: la pantalla por PlutoVG\n");   // (sigue el camino de antes, más lento)
  if(!(ren = SDL_CreateRenderer(win, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC))) return -1;
  SDL_RenderSetLogicalSize(ren, w, h);   // (SDL escala a la pantalla: 720p en portátil, 1080p en la base)
  if(!(tex = SDL_CreateTexture(ren, SDL_PIXELFORMAT_RGB888, SDL_TEXTUREACCESS_STREAMING, w, h))) return -1;
ready:
  {   // Abierto desde el álbum (applet) sólo hay ~440 MB: el juego no cabe. Hay que abrirlo como título (R sobre un juego).
    u64 total = 0, used = 0;
    AppletType at = appletGetAppletType();
    svcGetInfo(&total, InfoType_TotalMemorySize, CUR_PROCESS_HANDLE, 0);
    svcGetInfo(&used, InfoType_UsedMemorySize, CUR_PROCESS_HANDLE, 0);
    fprintf(stderr, "[switch] modo %s (applet %d), memoria %llu MB (usada %llu MB), %s\n",
            at == AppletType_Application || at == AppletType_SystemApplication ? "título" : "applet", (int)at,
            (unsigned long long)(total >> 20), (unsigned long long)(used >> 20),
            appletGetOperationMode() == AppletOperationMode_Console ? "en la base" : "portátil");
    if(at != AppletType_Application && at != AppletType_SystemApplication)
      plat_notify("Abierto como applet (desde el álbum): no hay memoria para el juego. Ábrelo manteniendo R sobre un juego.");
  }
  // Joy-Con de lado para quien juegue con uno solo (el sistema gira la cruceta y el stick).
  hidSetNpadJoyHoldType(HidNpadJoyHoldType_Horizontal);
  pad_mapping();
  return 0;
}

void
plat_present(void) {
  if(gpu_on) { gpu_present(win, &plat_copy_ms, &plat_wait_ms); return; }
  const double f = 1000.0 / SDL_GetPerformanceFrequency();
  Uint64 t0 = SDL_GetPerformanceCounter(), t1;
  SDL_UpdateTexture(tex, NULL, fb, fw * 4);
  SDL_RenderClear(ren);
  SDL_RenderCopy(ren, tex, NULL, NULL);
  t1 = SDL_GetPerformanceCounter();
  SDL_RenderPresent(ren);   // espera al vsync
  plat_copy_ms = (t1 - t0) * f;
  plat_wait_ms = (SDL_GetPerformanceCounter() - t1) * f;
}

void
plat_video_close(void) {
  if(ren) SDL_DestroyRenderer(ren);
  if(win) SDL_DestroyWindow(win);
}

void
plat_notify(const char *msg) { fprintf(stderr, "[aviso] %s\n", msg); }

// El idioma de la consola ("es", "en-US"…).
const char*
plat_lang(void) {
  static char tag[16];
  u64 code = 0;
  if(*tag) return tag;
  snprintf(tag, sizeof tag, "en-US");
  if(R_SUCCEEDED(setInitialize())) {
    if(R_SUCCEEDED(setGetSystemLanguage(&code))) snprintf(tag, sizeof tag, "%.8s", (const char*)&code);
    setExit();
  }
  return tag;
}

int
plat_user_name(int32_t user, char *name, size_t len) {   // ponytail: el perfil de Switch (accountGetPreselectedUser) cuando haga falta
  (void)user; (void)name; (void)len;
  return -1;
}

const char PLAT_NAME[] = "switch";

// ---------------- mandos ----------------
// El SDL2 de devkitPro (switch-sdl-2.28, src/joystick/switch): siempre 8 mandos, uno por npad (No1..No8; el 0 también es
// el modo portátil), abiertos al arrancar y sin avisos al conectar. Con un Joy-Con suelto, sus botones ya vienen girados
// para jugar de lado, el stick llega como cruceta (sin ejes), SL/SR como ZL/ZR y la pausa es pulsar el stick.

// ¿Joy-Con suelto (de lado)? El id de instancia del mando de SDL es su npad.
static int
single_joycon(SDL_GameController *pad) {
  SDL_Joystick *j = pad ? SDL_GameControllerGetJoystick(pad) : NULL;
  const int i = j ? SDL_JoystickInstanceID(j) : -1;
  u32 st;
  if(i < 0 || i >= 8) return 0;
  st = hidGetNpadStyleSet((HidNpadIdType)(HidNpadIdType_No1 + i));
  return (st & (HidNpadStyleTag_NpadJoyLeft | HidNpadStyleTag_NpadJoyRight)) && !(st & HidNpadStyleTag_NpadJoyDual);
}

// ps.pad().type: "joycon" (suelto: ui.js pinta la posición del botón) o "nintendo" (iconos y textos de Nintendo).
const char*
plat_pad_type(SDL_GameController *pad) { return single_joycon(pad) ? "joycon" : "nintendo"; }

// La pantalla táctil (en portátil): SDL la da también como ratón (dispositivo directo), en puntos de la ventana.
void
plat_mouse(int *x, int *y) { if(gpu_on) gpu_window_to_game(win, x, y); }

// El teclado del sistema (swkbd): para el apodo, el servidor, la contraseña… (ui.js, keyboard()). Bloquea hasta cerrarlo.
int
plat_text_input(const char *title, const char *init, int max, int mask, char *out, size_t n) {
  SwkbdConfig kbd;
  Result rc;
  if(R_FAILED(swkbdCreate(&kbd, 0))) return -1;
  if(mask) swkbdConfigMakePresetPassword(&kbd); else swkbdConfigMakePresetDefault(&kbd);
  swkbdConfigSetHeaderText(&kbd, title);
  swkbdConfigSetGuideText(&kbd, title);
  swkbdConfigSetInitialText(&kbd, init ? init : "");
  swkbdConfigSetStringLenMax(&kbd, max > 0 ? max : 64);
  *out = 0;
  rc = swkbdShow(&kbd, out, n);
  swkbdClose(&kbd);
  if(R_FAILED(rc)) { fprintf(stderr, "[switch] teclado: cerrado sin aceptar (0x%x)\n", rc); return 0; }
  return 1;
}

void
plat_pad_adjust(SDL_GameController *pad, int *b, double ax[6]) {
  if(!single_joycon(pad)) return;
  // SL / SR (gatillos para SDL) son los L / R del Joy-Con de lado: cambiar de ataque (core.js, el juego).
  if(ax[4] > 0.5) *b |= 1 << SDL_CONTROLLER_BUTTON_LEFTSHOULDER;
  if(ax[5] > 0.5) *b |= 1 << SDL_CONTROLLER_BUTTON_RIGHTSHOULDER;
  ax[4] = ax[5] = 0;
  // ponytail: el stick, digital (la cruceta de SDL, ya girada) también como stick: core.js mueve a los jugadores 2-4
  // sólo con él. Analógico con padGetStickPos si se echa en falta (girando los ejes a mano).
  if(*b & 1 << SDL_CONTROLLER_BUTTON_DPAD_LEFT) ax[0] = -1;
  else if(*b & 1 << SDL_CONTROLLER_BUTTON_DPAD_RIGHT) ax[0] = 1;
  if(*b & 1 << SDL_CONTROLLER_BUTTON_DPAD_UP) ax[1] = -1;
  else if(*b & 1 << SDL_CONTROLLER_BUTTON_DPAD_DOWN) ax[1] = 1;
}

// Botones por posición, como en el resto de plataformas (SDL_HINT_GAMECONTROLLER_USE_BUTTON_LABELS = 0 en escritorio):
// BUTTON_A = el de abajo (la B de Nintendo), BUTTON_B = el de la derecha (la A)… El SDL de Switch los da por su
// nombre: b0 = A, b1 = B, b2 = X, b3 = Y (en el Joy-Con suelto, los de su misma posición).
static void
pad_mapping(void) {
  char guid[64], map[512];
  SDL_JoystickGetGUIDString(SDL_JoystickGetDeviceGUID(0), guid, sizeof guid);
  snprintf(map, sizeof map, "%s,Switch Controller,a:b1,b:b0,x:b3,y:b2,leftstick:b4,rightstick:b5,leftshoulder:b6,"
           "rightshoulder:b7,lefttrigger:b8,righttrigger:b9,start:b10,back:b11,dpleft:b12,dpup:b13,dpright:b14,dpdown:b15,"
           "leftx:a0,lefty:a1,rightx:a2,righty:a3,", guid);
  if(SDL_GameControllerAddMapping(map) < 0) fprintf(stderr, "[switch] mapeo de mandos: %s\n", SDL_GetError());
}

// ---------------- pilas ----------------
// La pila del hilo principal y la de un pthread de libnx son pequeñas, y QuickJS cree tener 4 MB (main.c) o 2 MB (hilos
// del suelo, JS_SetMaxStackSize): al cargar el JS del juego se salía de ella y el programa se cerraba sin decir nada.
// Como el título de PS5: el juego en un hilo de 64 MB, y cada pthread sin tamaño pedido, con 4 MB.
#include <pthread.h>
int __real_pthread_create(pthread_t *t, const pthread_attr_t *a, void *(*fn)(void*), void *arg);
int
__wrap_pthread_create(pthread_t *t, const pthread_attr_t *a, void *(*fn)(void*), void *arg) {
  pthread_attr_t big;
  int rc;
  if(a) return __real_pthread_create(t, a, fn, arg);
  pthread_attr_init(&big);
  pthread_attr_setstacksize(&big, 4u << 20);
  rc = __real_pthread_create(t, &big, fn, arg);
  pthread_attr_destroy(&big);
  return rc;
}

int __real_main(int argc, char **argv);
static int g_argc;
static char **g_argv;
static void *game(void *arg) { (void)arg; return (void*)(intptr_t)__real_main(g_argc, g_argv); }
int
__wrap_main(int argc, char **argv) {
  pthread_attr_t attr;
  pthread_t t;
  void *ret = NULL;
  g_argc = argc; g_argv = argv;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 64u << 20);
  if(__real_pthread_create(&t, &attr, game, NULL)) return __real_main(argc, argv);
  pthread_join(t, &ret);
  return (int)(intptr_t)ret;
}

// Lo primero que pide main(): aquí se arranca lo de libnx que el resto da por hecho.
const char*
plat_root(void) {
  static int ok;
  if(!ok++) {
    romfsInit();              // el juego (shim/, game/, vendor/), metido en el .nro/.nsp
    socketInitializeDefault();   // red (curl, salas): sin ella, los sockets fallan
  }
  return "romfs:";
}

const char*
plat_data(void) {
  mkdir("sdmc:/switch", 0755);
  mkdir("sdmc:/switch/pokesurvivor", 0755);
  return "sdmc:/switch/pokesurvivor";
}

void
// @step nupdate/relaunch
plat_relaunch(char **argv) { (void)argv; }   // (no se puede volver a abrir un título; ps.relaunch sólo cambia la resolución en escritorio)

// El applet de mandos del sistema («Conecta los mandos»), de 1 a maxp jugadores. single: un Joy-Con suelto por jugador
// (si no, en pareja o mando Pro). Devuelve los jugadores conectados, o -1 si se canceló.
// SDL también lo abre solo cuando cambia un mando (despegar un Joy-Con, otro modo), con 8 jugadores y sin sueltos: con
// --wrap (Makefile.switch) va con el modo elegido aquí, y no se abre otra vez justo después del nuestro (SDL ve el cambio
// que acaba de hacer el applet y lo pediría de nuevo).
static int pad_single, pad_max = 4, in_setup;
static u64 setup_done;   // (armGetSystemTick al cerrarse el nuestro)

Result __real_hidLaShowControllerSupportForSystem(HidLaControllerSupportResultInfo *info, const HidLaControllerSupportArg *arg, bool flag);
Result
__wrap_hidLaShowControllerSupportForSystem(HidLaControllerSupportResultInfo *info, const HidLaControllerSupportArg *arg, bool flag) {
  HidLaControllerSupportArg a = *arg;
  if(!in_setup && setup_done && armTicksToNs(armGetSystemTick() - setup_done) < 2000000000ull) return 0;
  a.hdr.player_count_min = 1;
  a.hdr.player_count_max = pad_max;
  a.hdr.enable_single_mode = pad_single;
  a.hdr.enable_permit_joy_dual = 1;
  return __real_hidLaShowControllerSupportForSystem(info, &a, flag);
}

int
plat_pad_setup(int maxp, int single) {
  HidLaControllerSupportArg arg;
  HidLaControllerSupportResultInfo info;
  Result rc;
  pad_max = SDL_clamp(maxp, 1, 4);
  pad_single = single ? 1 : 0;
  hidLaCreateControllerSupportArg(&arg);
  in_setup = 1;
  rc = hidLaShowControllerSupportForSystem(&info, &arg, false);
  in_setup = 0;
  setup_done = armGetSystemTick();
  fprintf(stderr, "[switch] mandos: %s, %d jugadores (rc 0x%x)\n", pad_single ? "Joy-Con sueltos" : "normal",
          R_SUCCEEDED(rc) ? info.player_count : -1, rc);
  return R_SUCCEEDED(rc) ? info.player_count : -1;
}

// ---------------- lo que piden mbedTLS, usrsctp y libjuice (Makefile.switch, switch/include) ----------------
// mbedTLS 3 sin fuente de entropía ni reloj de la plataforma (MBEDTLS_ENTROPY_HARDWARE_ALT, MBEDTLS_PLATFORM_MS_TIME_ALT).
int
mbedtls_hardware_poll(void *data, unsigned char *out, size_t len, size_t *olen) {
  (void)data;
  randomGet(out, len);   // (aleatorio del sistema: el núcleo lo siembra)
  *olen = len;
  return 0;
}

long long
mbedtls_ms_time(void) { return (long long)(armTicksToNs(armGetSystemTick()) / 1000000); }

// libjuice: las direcciones locales (candidatos «host» de ICE). Sólo la IPv4 de la consola: gethostid de libnx.
#include <stdlib.h>
#include <arpa/inet.h>
#include <net/if.h>
#include "switch/include/ifaddrs.h"   // (la de compatibilidad: libnx no la trae)
int
getifaddrs(struct ifaddrs **ifap) {
  struct { struct ifaddrs ifa; struct sockaddr_in addr, mask; char name[8]; } *p;
  const long ip = gethostid();   // (en orden de red; 127.0.0.1 si no hay red)
  *ifap = NULL;
  if(!(p = calloc(1, sizeof *p))) return -1;
  p->addr.sin_family = p->mask.sin_family = AF_INET;
  p->addr.sin_len = p->mask.sin_len = sizeof p->addr;
  p->addr.sin_addr.s_addr = (in_addr_t)ip;
  p->mask.sin_addr.s_addr = htonl(0xffffff00);
  strcpy(p->name, "wlan0");
  p->ifa.ifa_name = p->name;
  p->ifa.ifa_flags = IFF_UP | IFF_RUNNING;
  p->ifa.ifa_addr = (struct sockaddr*)&p->addr;
  p->ifa.ifa_netmask = (struct sockaddr*)&p->mask;
  *ifap = &p->ifa;
  return 0;
}

void
freeifaddrs(struct ifaddrs *ifa) { free(ifa); }   // (una sola, y es el principio del bloque)

// libjuice (conn_poll.c) despierta su poll() escribiendo en una tubería; libnx no tiene pipe(), pero sus sockets son
// descriptores de newlib (read, write, poll y fcntl valen): dos sockets UDP en 127.0.0.1, el de escribir conectado al otro.
int
pipe(int fd[2]) {
  struct sockaddr_in a = { .sin_len = sizeof a, .sin_family = AF_INET }, b;
  socklen_t l = sizeof b;
  const int r = socket(AF_INET, SOCK_DGRAM, 0), w = socket(AF_INET, SOCK_DGRAM, 0);
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if(r >= 0 && w >= 0 && !bind(r, (struct sockaddr*)&a, sizeof a) && !getsockname(r, (struct sockaddr*)&b, &l) &&
     !connect(w, (struct sockaddr*)&b, sizeof b)) {
    fd[0] = r; fd[1] = w;
    return 0;
  }
  if(r >= 0) close(r);
  if(w >= 0) close(w);
  return -1;
}

int
plat_pick_file(void) { return 0; }   // (sólo Android)

void
plat_keep_alive(int on) { (void)on; }   // (sólo Android)

int
plat_has_keyboard(void) { return 0; }   // (ui.js usa su teclado o el del sistema; ps.has_keyboard es de escritorio)
