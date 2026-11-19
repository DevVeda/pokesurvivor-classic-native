/* net.h — HTTP(S) y WebSocket para el JS (net.c). SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
#include "quickjs.h"

/* Arranca el hilo de red y pone ps.net_*. root: donde está cacert.pem. */
int net_init(JSContext *ctx, JSValue ps, const char *root, void (*log)(const char *fmt, ...));
/* Al recargar el JS: corta lo pendiente y tira sus eventos (no llegan al contexto nuevo). */
void net_reset(void);
/* Certificados y DNS como las peticiones del juego, para un CURL* de otro hilo (update.c). */
void net_easy_setup(void *easy, const char *url);
