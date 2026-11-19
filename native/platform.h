/* Lo que cambia de una plataforma a otra: platform/<nombre>.c (el Makefile elige uno).
 * Mando, audio, relojes e hilos van por SDL2 y pthreads en todas; aquí sólo lo que SDL no cubre igual.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#ifndef PLATFORM_H
#define PLATFORM_H
#include <stddef.h>
#include <stdint.h>
#include <SDL2/SDL.h>

void plat_screen_size(int *w, int *h);       // la pantalla del juego en píxeles de dibujo (ps.W x ps.H): PS5 960x540;
                                              // escritorio, la de Ajustes (plat_data()/resolution.txt); si no hay, 1920x1080 (Steam Deck 1280x720)
int  plat_video_init(const Uint32 *screen, int w, int h);   // screen: w x h, ARGB premultiplicado (PlutoVG). 0 si va bien (si no, SDL_GetError)
void plat_present(void);                      // a la pantalla, esperando al vsync
void plat_video_close(void);
extern double plat_copy_ms, plat_wait_ms;     // lo que costó el último plat_present (copiar y esperar), para el log

void plat_relaunch(char **argv);              // volver a abrir el programa (ps.relaunch); si vuelve, no se pudo
void plat_notify(const char *msg);            // aviso del sistema (o el log, si no hay)
const char *plat_root(void);                  // los archivos del juego (shim/, game/, vendor/, cacert.pem); sólo se leen
const char *plat_data(void);                  // donde se escribe: log.txt, user/<perfil>/localStorage.json, miniaturas
const char *plat_lang(void);                  // idioma del sistema, BCP 47 (navigator.language)
int  plat_user_name(int32_t user, char *name, size_t len);   // nombre del perfil; 0 si lo hay
const char *plat_pad_type(SDL_GameController *pad);   // "ps" | "xbox" | "nintendo" | "": qué iconos pinta ui.js
void plat_mouse(int *x, int *y);              // el ratón (o un toque) de la ventana a píxeles de la pantalla del juego
int  plat_text_input(const char *title, const char *init, int max, int mask, char *out, size_t n);
                                              // teclado del sistema: 1 aceptado (out), 0 cancelado, -1 no hay (ui.js usa el suyo)
void plat_pad_adjust(SDL_GameController *pad, int *b, double ax[6]);   // retocar lo leído (b: bits SDL; ax: lx ly rx ry l2 r2)
int  plat_pick_file(void);                    // el selector de archivos del sistema (Android); lo elegido llega como SDL_DROPFILE.
                                              // 1 si se abrió (las demás: 0; en escritorio se arrastra a la ventana)
void plat_keep_alive(int on);                 // que el sistema no congele el proceso en segundo plano (Android: servicio en primer
                                              // plano mientras se espera la vuelta de Google a 127.0.0.1); las demás: nada
int  plat_has_keyboard(void);                 // ¿hay teclado físico? 1 sí (o no se sabe), 0 seguro que no (tablet): ui.js saca el de la
                                              // pantalla. Sólo platform/sdl.c (ps.has_keyboard, escritorio; Android: 1, usa el del sistema)
int  plat_pad_setup(int maxp, int single);    // el applet de mandos del sistema (Switch); devuelve los mandos o -1 (las demás: -1)
extern const char PLAT_NAME[];                // ps.PLATFORM: "ps5" | "desktop" | "switch" | "android": lo que cambia en el JS, por esto

#endif
