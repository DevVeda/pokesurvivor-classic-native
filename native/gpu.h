/* gpu.h — la pantalla por GPU: OpenGL (gpu.c) o Vulkan en el título de PS5 (gpu_vk.c). canvas.c le manda los dibujos de la pantalla y la plataforma la presenta.
 * Los lienzos fuera de pantalla siguen en PlutoVG y se suben como textura cuando cambian. Ver SWITCH.md, fase 2.
 * Colores en ARGB premultiplicado (el formato de PlutoVG); op = el índice de OPS de canvas.c.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#pragma once
#include <SDL2/SDL_stdinc.h>
struct SDL_Window;   // (sin SDL.h: el SDL mínimo del título de PS5 no tiene vídeo)

extern int gpu_on;   // 1 tras gpu_open: la pantalla la pinta la GPU y su búfer de PlutoVG es sólo un borrador
extern const char *volatile gpu_step;   // paso de gpu_present en curso (lo dice el vigilante de main.c si se para)

int  gpu_open(struct SDL_Window *win, int w, int h);   // contexto GL y la pantalla (w x h) en la GPU; 0 si va bien
void gpu_present(struct SDL_Window *win, double *copy_ms, double *wait_ms);   // a la ventana (con bandas), esperando al vsync

unsigned gpu_upload(unsigned tex, const Uint32 *px, int w, int h, int stride);   // crea (tex 0) o rehace una textura
void gpu_delete(unsigned tex);                                                   // (al final del fotograma)
unsigned gpu_image(const void *key, const Uint32 *px, int w, int h, int stride); // textura de una imagen que no cambia
void gpu_forget(const void *key);                                                // esa imagen se va a destruir

/* Un cuadrilátero: xy = 4 esquinas en píxeles de pantalla (arriba-izq, arriba-der, abajo-der, abajo-izq), con el trozo
 * (sx, sy, sw, sh) de la textura (tw x th) y multiplicado por el color (r, g, b, a premultiplicado). tex 0 = blanco.
 * r < 0: silueta (la transparencia de la textura en blanco, por |r|, g, b, a): el destello de los golpes (canvas.c cv_draw). */
void gpu_quad(unsigned tex, int tw, int th, int op, const float *xy, float sx, float sy, float sw, float sh,
              float r, float g, float b, float a);
/* Un trozo del borrador (lo que PlutoVG acaba de pintar) a la pantalla, en (x, y), mezclado con op. */
void gpu_scratch(const Uint32 *px, int stride, int x, int y, int w, int h, int op);
/* El recorte de la pantalla (ctx.clip): npoly polígonos (count[i] puntos cada uno, seguidos en xy, en píxeles de
 * pantalla), par-impar. Hasta gpu_clip_off, sólo se pinta dentro. Uno a la vez (canvas.c: el de dentro, por la CPU). */
void gpu_clip(const float *xy, const int *count, int npoly);
void gpu_clip_off(void);
/* Un punto de la ventana (en sus puntos, como los eventos de ratón de SDL) a píxeles de la pantalla del juego. */
void gpu_window_to_game(struct SDL_Window *win, int *x, int *y);
/* La pantalla, leída de la GPU, a dst (w x h, ARGB premultiplicado): para getImageData, drawImage desde la pantalla, ps.shot. */
void gpu_read(Uint32 *dst, int w, int h);
/* Una línea para el log cada 5 s (main.c, junto a [dibujo]); frames = los fotogramas desde la anterior (0: sólo reinicia). */
void gpu_prof(void (*say)(const char *fmt, ...), unsigned long frames);
