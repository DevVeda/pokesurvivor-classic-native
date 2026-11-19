/* webrtc.h — RTCPeerConnection para el JS (webrtc.c). SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once
#include "quickjs.h"

/* Pone ps.rtc_*. */
void rtc_init(JSContext *ctx, JSValue ps, void (*log)(const char *fmt, ...));
/* Al recargar el JS: cierra las conexiones y tira sus eventos. */
void rtc_reset(void);
