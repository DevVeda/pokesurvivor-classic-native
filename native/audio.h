/* audio.h — Web Audio en C (audio.c). SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
#include "quickjs.h"

/* Abre la salida de audio (SDL, 48 kHz) y pone las funciones ps.au_* en ps. 0 si fue bien. */
int audio_init(JSContext *ctx, JSValue ps);
/* Jugadores 2-4 (cooperativo local): sus ps.au_*, con su salida al altavoz del mando de su usuario. 0 si fue bien. */
int audio_player(JSContext *ctx, JSValue ps, int me, int32_t user);
/* El altavoz del mando de un usuario como salida del jugador me (0-3). 0 si fue bien. */
int audio_pad(int me, int32_t user);
