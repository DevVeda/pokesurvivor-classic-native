/* update.h — actualizaciones firmadas (update.c, docs/updates.md). SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
#include <stddef.h>
#include "quickjs.h"

/* Una vez al arrancar, antes de cargar nada: decide de dónde se lee el juego (la versión instalada o la del binario).
   En escritorio, si hay un binario bajado más nuevo, se le pasa el control aquí (exec, con argv) y no vuelve. */
void upd_init(const char *root, const char *data, void (*log)(const char *fmt, ...), char **argv);
/* exec de exe (NULL: este mismo) con argv; en Windows, otro proceso con las comillas bien puestas y éste sale. Si vuelve, falló. */
void upd_exec(const char *exe, char **argv);
/* La ruta que hay que abrir para <root>/shim/… o <root>/game/…: la de la versión instalada si la tiene; si no, la misma.
 * buf: donde escribirla (n bytes). Se puede llamar desde cualquier hilo. */
const char *upd_path(const char *path, char *buf, size_t n);
/* ps.UPD_*, ps.sha512, ps.ed25519_ok, ps.upd_* (cada contexto JS nuevo). */
void upd_register(JSContext *ctx, JSValue ps);
