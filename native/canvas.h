/* canvas.h — el CanvasRenderingContext2D en C (canvas.c). SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
#include <SDL2/SDL_stdinc.h>
#include "quickjs.h"

/* Envuelve el búfer de la pantalla (ARGB premultiplicado, w*4 de paso) como lienzo; devuelve su id. */
int canvas_screen(Uint32 *pixels, int w, int h);
/* Con la pantalla en la GPU (gpu.c): 1 = traerla al búfer de la pantalla (para leerla), 0 = dejarlo de borrador. */
void canvas_screen_sync(int read);
/* Los píxeles de un lienzo (ARGB premultiplicado; stride en píxeles), o NULL si no existe. */
const Uint32 *canvas_pixels(int id, int *w, int *h, int *stride);
/* Carpeta con PixelifyPS-400.ttf y PixelifyPS-700.ttf. */
void canvas_set_font_dir(const char *dir);
/* Pone las funciones ps.cv_* en el objeto ps. */
void canvas_register(JSContext *ctx, JSValue ps);
/* La última función de dibujo llamada y su lienzo (para el informe de un cierre). */
extern const char *volatile canvas_last;
extern volatile int canvas_last_id;
extern volatile unsigned long canvas_calls, canvas_loads;   // llamadas de dibujo e imágenes cargadas desde el arranque
/* Para el hilo del suelo (tiles_worker.c): la generación actual de un lienzo, y escribir en él RGBA
 * (sin premultiplicar) si sigue siendo el mismo. */
unsigned canvas_gen(int id);
void canvas_put_rgba(int id, unsigned gen, const Uint8 *px, int w, int h);
/* Una línea para el log con lo que cuesta dibujar (ms por fotograma y las funciones más caras) desde la anterior. */
void canvas_prof(void (*say)(const char *fmt, ...), unsigned long frames);
