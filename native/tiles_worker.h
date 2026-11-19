/* tiles_worker.h — el suelo del mapa en otro hilo (tiles_worker.c). SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
#include "quickjs.h"

/* Arranca los hilos y pone ps.tw_paint / ps.tw_arena. log escribe en el log (desde cualquier hilo). */
int tiles_worker_init(JSContext *ctx, JSValue ps, const char *root_dir, void (*log)(const char *fmt, ...));
