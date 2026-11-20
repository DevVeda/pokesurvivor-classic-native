/* La plataforma de escritorio (Mac, Linux, Windows; ver platform.h): una ventana SDL2 con la pantalla del juego
 * escalada (sin suavizar, con bandas si la ventana no es 16:9). Mando y audio, como en la PS5, por SDL2.
 * Android también usa éste (pantalla completa, siempre por la GPU, táctil): lo suyo (rutas, reabrir, teclado del sistema,
 * selector de archivos) está en platform/android.c.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/stat.h>
#ifdef _WIN32
#include <windows.h>                // (GetSystemMetrics: plat_has_keyboard)
#include <process.h>                // (execv)
#ifndef SM_CONVERTIBLESLATEMODE     // (MinGW sólo la define desde Windows 8, _WIN32_WINNT 0x0602; pedimos 0x0601)
#define SM_CONVERTIBLESLATEMODE 0x2003
#endif
#define mkdir(p, mode) mkdir(p)     // (el de Windows no lleva permisos)
#endif
#include <string.h>
#include <SDL2/SDL.h>
#include "platform.h"
#include "gpu.h"

double plat_copy_ms, plat_wait_ms;
static const Uint32 *fb;
static SDL_Window *win;
static SDL_Renderer *ren;
static SDL_Texture *tex;
static int fw, fh;

// La resolución de Ajustes (ui.js la escribe en plat_data()/resolution.txt, "1920x1080", y reinicia el juego).
void
plat_screen_size(int *w, int *h) {
  char path[1100];
  int a = 0, b = 0;
  FILE *f;
  // Por defecto 1920x1080 (en un Mac M1, la partida a 8,5 ms por fotograma); en la Steam Deck (1280x800), 1280x720.
  if(getenv("SteamDeck")) { *w = 1280; *h = 720; } else { *w = 1920; *h = 1080; }
#ifdef __ANDROID__
  *w = 1280; *h = 720;   // ponytail: un móvil va justo con QuickJS; más, desde Ajustes
#endif
  snprintf(path, sizeof path, "%s/resolution.txt", plat_data());
  if((f = fopen(path, "r"))) {
    // ponytail: como mucho 1920x1080: el juego dibuja a ×1,5 de su tamaño lógico (1280x720; game.js resize) y no más, así
    // que con más resolución lo de fuera se quedaba sin pintar. Para ventanas más grandes ya escala SDL.
    if(fscanf(f, "%dx%d", &a, &b) == 2 && a >= 640 && b >= 360) { *w = SDL_min(a, 1920); *h = SDL_min(b, 1080); }
    fclose(f);
  }
#ifdef __ANDROID__
  // La forma de la pantalla del móvil (20:9…), no 16:9 con bandas: el alto de Ajustes y el ancho que toque. El juego ve
  // más mundo a los lados; los menús (ui.js, 960x540) van centrados. (Ajustes guarda "1280x720": cuenta el alto.)
  SDL_DisplayMode dm;
  if(!SDL_InitSubSystem(SDL_INIT_VIDEO) && !SDL_GetDesktopDisplayMode(0, &dm) && dm.w > 0 && dm.h > 0) {
    const double asp = SDL_min(2.4, (double)SDL_max(dm.w, dm.h) / SDL_min(dm.w, dm.h));
    if(asp > 16.0 / 9) *w = (int)(*h * asp) & ~1;
  }
#endif
}

int
plat_video_init(const Uint32 *screen, int w, int h) {
  SDL_DisplayMode dm;
  int ww = w, wh = h;
  fb = screen; fw = w; fh = h;
  if(SDL_InitSubSystem(SDL_INIT_VIDEO)) return -1;
  SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "1");   // escalado suave (la pantalla ya va a la resolución elegida)
  // La ventana: la resolución, sin pasarse del 85 % del monitor (en puntos: en un Retina, 1920x1080 cabe holgado).
  if(!SDL_GetDesktopDisplayMode(0, &dm) && (ww > dm.w * 0.85 || wh > dm.h * 0.85)) {
    const double k = SDL_min(dm.w * 0.85 / ww, dm.h * 0.85 / wh);
    ww = (int)(ww * k); wh = (int)(wh * k);
  }
  // La pantalla por OpenGL (gpu.c, como Switch y Android); sin GL (o POKESURVIVOR_GPU=0), PlutoVG + SDL_Renderer.
  const char *g = getenv("POKESURVIVOR_GPU");
  int want_gpu = !(g && *g == '0');
  Uint32 flags = SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI;
  // Pantalla táctil (tablet, portátil táctil, Android): cada dedo al JS (main.c, SDL_FINGER*), no como ratón: el joystick
  // táctil del juego (G.Touch) y los toques de ui.js, como en el móvil.
  SDL_SetHint(SDL_HINT_TOUCH_MOUSE_EVENTS, "0");
#ifdef __ANDROID__
  // Android: pantalla completa en horizontal, siempre por la GPU (ES 3.0; plat_mouse cuenta con ella). Los dedos van uno a
  // uno al JS (main.c, SDL_FINGER*: con TOUCH_MOUSE_EVENTS a 0 no hacen de ratón) y «atrás» llega como tecla (AC Back).
  // Sin SDL_StartTextInput: sacaría el teclado del sistema (sólo al escribir: ps.text_mode).
  want_gpu = 1;
  flags = SDL_WINDOW_FULLSCREEN;
  SDL_SetHint(SDL_HINT_ANDROID_TRAP_BACK_BUTTON, "1");
  SDL_SetHint(SDL_HINT_ORIENTATIONS, "LandscapeLeft LandscapeRight");
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
#define SDL_StartTextInput() ((void)0)
#endif
  win = want_gpu ? SDL_CreateWindow("PokéSurvivor", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, ww, wh, flags | SDL_WINDOW_OPENGL) : NULL;
  if(win && !gpu_open(win, w, h)) { SDL_StartTextInput(); return 0; }
  if(want_gpu) {   // sin GL (o falló gpu_open): otra ventana sin OpenGL y el camino de la CPU
    fprintf(stderr, "[gpu] sin OpenGL: la pantalla por PlutoVG\n");
    if(SDL_GL_GetCurrentContext()) SDL_GL_DeleteContext(SDL_GL_GetCurrentContext());
    if(win) SDL_DestroyWindow(win);
  }
  if(!(win = SDL_CreateWindow("PokéSurvivor", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, ww, wh, flags)))
    return -1;
  // Con GPU y vsync; si no hay (un Linux sin aceleración, SDL_VIDEODRIVER=dummy en las pruebas), el de software.
  if(!(ren = SDL_CreateRenderer(win, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC)) &&
     !(ren = SDL_CreateRenderer(win, -1, SDL_RENDERER_SOFTWARE))) return -1;
  SDL_RenderSetLogicalSize(ren, w, h);
  SDL_StartTextInput();   // (SDL_TEXTINPUT: escribir en el buscador de la Pokédex, el nombre…)
  // El alfa de la pantalla no cuenta (la PS5 lo pone a 0xff al copiar): XRGB.
  if(!(tex = SDL_CreateTexture(ren, SDL_PIXELFORMAT_RGB888, SDL_TEXTUREACCESS_STREAMING, w, h))) return -1;
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
plat_notify(const char *msg) {
  fprintf(stderr, "[aviso] %s\n", msg);   // ponytail: al log; SDL_ShowSimpleMessageBox si hiciera falta verlo
}

// El primer idioma del sistema como etiqueta BCP 47 ("es-ES").
const char*
plat_lang(void) {
  static char tag[16];
  SDL_Locale *l = SDL_GetPreferredLocales();
  if(!l || !l[0].language) { SDL_free(l); return "en-US"; }
  if(l[0].country) snprintf(tag, sizeof tag, "%s-%s", l[0].language, l[0].country);
  else snprintf(tag, sizeof tag, "%s", l[0].language);
  SDL_free(l);
  return tag;
}

int
plat_user_name(int32_t user, char *name, size_t len) {   // (sólo lo pide el título de la PS5)
  (void)user; (void)name; (void)len;
  return -1;
}

#ifndef __ANDROID__   // (Android: platform/android.c)
const char PLAT_NAME[] = "desktop";
#endif

// La Steam Deck: sus controles (o Steam Input, que los da como un mando virtual) en SteamOS ponen SteamDeck=1.
const char*
plat_pad_type(SDL_GameController *pad) {
  const char *name = SDL_GameControllerName(pad);
  if(getenv("SteamDeck") || (name && strstr(name, "Steam Deck"))) return "steamdeck";
  switch(SDL_GameControllerGetType(pad)) {
  case SDL_CONTROLLER_TYPE_PS3: case SDL_CONTROLLER_TYPE_PS4: case SDL_CONTROLLER_TYPE_PS5: return "ps";
  case SDL_CONTROLLER_TYPE_NINTENDO_SWITCH_PRO: return "nintendo";
#if SDL_VERSION_ATLEAST(2, 24, 0)   // (los Joy-Con sueltos; Ubuntu 22.04 trae la 2.0.20)
  case SDL_CONTROLLER_TYPE_NINTENDO_SWITCH_JOYCON_LEFT: case SDL_CONTROLLER_TYPE_NINTENDO_SWITCH_JOYCON_RIGHT:
  case SDL_CONTROLLER_TYPE_NINTENDO_SWITCH_JOYCON_PAIR: return "nintendo";
#endif
  default: return "xbox";   // (Xbox y los genéricos, que suelen imitarlo)
  }
}

#ifndef __ANDROID__   // rutas, reabrir, teclado del sistema y selector de archivos: los de Android, en platform/android.c
// Sin barra al final.
static void
trim(char *p) {
  size_t n = strlen(p);
  while(n > 1 && (p[n - 1] == '/' || p[n - 1] == '\\')) p[--n] = 0;
}

// Los archivos del juego: POKESURVIVOR_ROOT, o junto al ejecutable (en un .app, su Contents/Resources: SDL_GetBasePath),
// o en ../share/pokesurvivor (AppImage y paquetes de Linux: bin/ y share/).
const char*
plat_root(void) {
  static char p[1024];
  if(*p) return p;
  const char *env = getenv("POKESURVIVOR_ROOT");
  char *base = env ? NULL : SDL_GetBasePath(), probe[1100];
  snprintf(p, sizeof p, "%s", env ? env : base ? base : ".");
  SDL_free(base);
  trim(p);
  snprintf(probe, sizeof probe, "%s/shim/boot.js", p);
  if(!env && access(probe, R_OK) != 0) {
    char share[1024];
    snprintf(share, sizeof share, "%s/../share/pokesurvivor", p);
    snprintf(probe, sizeof probe, "%s/shim/boot.js", share);
    if(access(probe, R_OK) == 0) snprintf(p, sizeof p, "%s", share);
  }
  return p;
}

// Donde se escribe: POKESURVIVOR_DATA, o la carpeta del usuario para el juego (SDL_GetPrefPath: ~/Library/Application
// Support/PokeSurvivor en Mac, ~/.local/share/PokeSurvivor en Linux, %APPDATA%\PokeSurvivor en Windows).
const char*
plat_data(void) {
  static char p[1024];
  if(*p) return p;
  const char *env = getenv("POKESURVIVOR_DATA");
  char *pref = env ? NULL : SDL_GetPrefPath("", "PokeSurvivor");
  snprintf(p, sizeof p, "%s", env ? env : pref ? pref : ".");
  SDL_free(pref);
  trim(p);
  mkdir(p, 0755);   // (POKESURVIVOR_DATA puede no existir; SDL_GetPrefPath ya la crea)
  return p;
}

#ifdef _WIN32
void upd_exec(const char *exe, char **argv);   // (update.c)
#endif
void
plat_relaunch(char **argv) {
#ifdef _WIN32
  upd_exec(NULL, argv);   // (el execv de MSVCRT no pone comillas: con un espacio en la ruta, el nuevo recibía otros argv)
#else
  // @step nupdate/relaunch platform "plat_relaunch"
  // sdl.c: execv (Windows: CreateProcess); Android: Restart; PS5/Switch: no-op.
  // @next seq "nuevo arranque"
  execv(argv[0], argv);   // (el mismo ejecutable: en un .app, Contents/MacOS/PokeSurvivor, con su ruta entera)
#endif
}

int
plat_pick_file(void) { return 0; }   // (sólo Android: en escritorio se arrastra a la ventana, SDL_DROPFILE)

void
plat_keep_alive(int on) { (void)on; }   // (sólo Android: el escritorio no congela los programas en segundo plano)

int
plat_text_input(const char *title, const char *init, int max, int mask, char *out, size_t n) {   // (sólo Switch y Android)
  (void)title; (void)init; (void)max; (void)mask; (void)out; (void)n;
  return -1;
}
#endif

// Windows: tablet (con pantalla táctil) en modo «tableta» = sin teclado (el Surface sin su funda). Linux: algún dispositivo
// con el manejador «kbd» y LEDs (Bloq Mayús: EV_LED, bit 17 de EV), como los teclados de verdad (los botones de encendido o
// volumen no tienen). Mac y Android: 1. Si se pulsa una tecla, browser.js ya no hace caso de esto (psKbSeen).
int
plat_has_keyboard(void) {
#if defined(_WIN32)
  return !((GetSystemMetrics(SM_DIGITIZER) & NID_READY) && GetSystemMetrics(SM_CONVERTIBLESLATEMODE) == 0);
#elif defined(__linux__) && !defined(__ANDROID__)
  FILE *f = fopen("/proc/bus/input/devices", "r");
  char line[512];
  int kbd = 0, found = 0;
  unsigned long ev;
  if(!f) return 1;
  while(!found && fgets(line, sizeof line, f)) {
    if(line[0] == '\n') kbd = 0;   // (otro dispositivo)
    else if(!strncmp(line, "H: Handlers=", 12)) kbd = strstr(line, "kbd") != NULL;
    else if(kbd && sscanf(line, "B: EV=%lx", &ev) == 1 && (ev & (1ul << 17))) found = 1;
  }
  fclose(f);
  return found;
#else
  return 1;
#endif
}

int
plat_pad_setup(int maxp, int single) { (void)maxp; (void)single; return -1; }   // (sólo Switch tiene el applet de mandos)

void
plat_pad_adjust(SDL_GameController *pad, int *b, double ax[6]) { (void)pad; (void)b; (void)ax; }   // (sólo Switch: el Joy-Con suelto)

// Con SDL_Renderer (RenderSetLogicalSize) SDL ya da el ratón en píxeles del juego; con la GPU, en los de la ventana.
void
plat_mouse(int *x, int *y) { if(gpu_on) gpu_window_to_game(win, x, y); }

