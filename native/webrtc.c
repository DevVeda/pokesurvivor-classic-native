/* webrtc.c — RTCPeerConnection y canal de datos para el JS (native/shim/net.js), con libdatachannel.
 *
 * El cooperativo de la web (js/net/net.js) conecta con WebRTC: canal de datos directo entre jugadores, con STUN
 * de Google; la señalización va por la Realtime Database (eso ya lo hace el SDK de Firebase sobre el WebSocket
 * de net.c). libdatachannel (+ libjuice para ICE y usrsctp para SCTP, DTLS con el OpenSSL del SDK) llama desde
 * sus hilos; aquí se encola y el JS lo recoge cada fotograma con ps.rtc_poll(), como ps.net_poll().
 *
 *   ps.rtc_pc(servidores "url\n...") -> id|-1      ps.rtc_close_pc(pc)
 *   ps.rtc_dc(pc, etiqueta) -> id|-1               ps.rtc_close_dc(dc)
 *   ps.rtc_local(pc, 'offer'|'answer') -> bool     ps.rtc_remote(pc, sdp, tipo) -> bool
 *   ps.rtc_cand(pc, candidato, mid) -> bool        ps.rtc_send(dc, texto|ArrayBuffer) -> bool
 *   ps.rtc_buffered(dc) -> bytes por salir
 *   ps.rtc_poll() -> [[tipo, id, ...], ...]
 *     ['desc', pc, sdp, tipo]  ['cand', pc, candidato, mid]  ['gather', pc, 'complete']  ['state', pc, estado]
 *     ['dc', pc, dc, etiqueta]  ['open', dc]  ['close', dc]  ['msg', dc, texto|ArrayBuffer]  ['err', dc, mensaje]
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <netdb.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#endif
#include <rtc/rtc.h>

#include "quickjs.h"
#include "webrtc.h"

static void (*say)(const char *fmt, ...);

// usrsctp lo toma de la libc en FreeBSD, pero la de la PS5 no lo trae. Comparación en tiempo constante (firmas).
// (En Mac, Linux y Windows lo pone el propio usrsctp: sctp_userspace.c.)
#if !defined(__APPLE__) && !defined(__linux__) && !defined(_WIN32)
int
timingsafe_bcmp(const void *b1, const void *b2, size_t n) {
  const unsigned char *p1 = b1, *p2 = b2;
  int r = 0;
  while(n--) r |= *p1++ ^ *p2++;
  return r != 0;
}
#endif

typedef struct rev {
  struct rev *next;
  int kind, id, id2, bin;
  char *a, *b;
  size_t len;
} rev_t;

enum { R_DESC, R_CAND, R_GATHER, R_STATE, R_DC, R_OPEN, R_CLOSE, R_MSG, R_ERR };
static const char *R_NAME[] = { "desc", "cand", "gather", "state", "dc", "open", "close", "msg", "err" };
static const char *STATE[] = { "new", "connecting", "connected", "disconnected", "failed", "closed" };

static rev_t *q_head, *q_tail;
static pthread_mutex_t q_mx = PTHREAD_MUTEX_INITIALIZER;
// Sube al recargar el JS (rtc_reset): lo de las conexiones de antes se tira. Va en el puntero de usuario de cada id.
static volatile intptr_t rtc_gen = 1;

// Conexiones abiertas (para cerrarlas al recargar). ponytail: 16 bastan (la sala es de 4).
#define MAX_PC 16
static int pcs[MAX_PC], n_pcs;

static char*
dupn(const char *s, size_t n) {
  char *d = malloc(n + 1);
  if(d) { if(n) memcpy(d, s, n); d[n] = 0; }
  return d;
}

static void
emit(void *ptr, int kind, int id, int id2, const char *a, size_t alen, const char *b, int bin) {
  rev_t *e;
  if((intptr_t)ptr != rtc_gen || !(e = calloc(1, sizeof *e))) return;
  e->kind = kind; e->id = id; e->id2 = id2; e->bin = bin;
  if(a) { e->a = dupn(a, alen); e->len = alen; }
  if(b) e->b = dupn(b, strlen(b));
  pthread_mutex_lock(&q_mx);
  if(q_tail) q_tail->next = e; else q_head = e;
  q_tail = e;
  pthread_mutex_unlock(&q_mx);
}

// ---------------- getaddrinfo ----------------
// libjuice pide sus direcciones con getaddrinfo (AI_PASSIVE | AI_NUMERICSERV, protocolo UDP, puerto "0") y la de
// la PS5 lo rechaza: sin puerto UDP no hay candidatos ICE. Se enlaza con --wrap=getaddrinfo (Makefile): si falla,
// se repite con lo justo y, para una IPv4 escrita (o ninguna), se rellena a mano. Un solo bloque (addrinfo +
// sockaddr_in) que suelta __wrap_freeaddrinfo (el freeaddrinfo de la PS5 no es el de FreeBSD: con un bloque
// que no es suyo, «heap error» y señal 6). La PS5 no acepta el puerto "0" (EAI_SERVICE).
int __real_getaddrinfo(const char*, const char*, const struct addrinfo*, struct addrinfo**);
void __real_freeaddrinfo(struct addrinfo*);

#define MINE_MAX 64   // ponytail: bloques propios vivos a la vez; libjuice suelta cada uno al momento
static struct addrinfo *mine[MINE_MAX];
static pthread_mutex_t mine_mx = PTHREAD_MUTEX_INITIALIZER;

void
__wrap_freeaddrinfo(struct addrinfo *ai) {
  pthread_mutex_lock(&mine_mx);
  for(int i = 0; i < MINE_MAX; i++)
    if(ai && mine[i] == ai) { mine[i] = NULL; pthread_mutex_unlock(&mine_mx); free(ai); return; }
  pthread_mutex_unlock(&mine_mx);
  __real_freeaddrinfo(ai);
}

int
__wrap_getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res) {
  int r = __real_getaddrinfo(node, service, hints, res), r2;
  struct addrinfo h;
  struct in_addr a;
  char *end;
  long port;
  static int told;
  if(!r || !hints) return r;
  h = *hints;
  h.ai_flags &= AI_PASSIVE | AI_NUMERICHOST;
  h.ai_protocol = 0;
  if(!(r2 = __real_getaddrinfo(node, service, &h, res))) return 0;
  if(!told++ && say) say("[rtc] getaddrinfo(%s, %s) falla (%d, sin opciones %d): se rellena a mano\n", node ? node : "NULL", service ? service : "NULL", r, r2);
  if(hints->ai_family == AF_INET6) return r;
  if(node) { if(inet_pton(AF_INET, node, &a) != 1) return r; }
  else a.s_addr = htonl(hints->ai_flags & AI_PASSIVE ? INADDR_ANY : INADDR_LOOPBACK);
  port = service ? strtol(service, &end, 10) : 0;
  if(service && (*end || port < 0 || port > 65535)) return r;
  {
    struct { struct addrinfo ai; struct sockaddr_in sa; } *b = calloc(1, sizeof *b);
    int slot = -1;
    if(!b) return EAI_MEMORY;
    pthread_mutex_lock(&mine_mx);
    for(int i = 0; i < MINE_MAX && slot < 0; i++) if(!mine[i]) { mine[i] = &b->ai; slot = i; }
    pthread_mutex_unlock(&mine_mx);
    if(slot < 0) { free(b); return r; }
#if !defined(__linux__) && !defined(_WIN32)   // (sin_len: BSD, la PS5 y macOS; Linux y Windows no lo tienen)
    b->sa.sin_len = sizeof b->sa;
#endif
    b->sa.sin_family = AF_INET;
    b->sa.sin_port = htons((unsigned short)port);
    b->sa.sin_addr = a;
    b->ai.ai_family = AF_INET;
    b->ai.ai_socktype = hints->ai_socktype ? hints->ai_socktype : SOCK_DGRAM;
    b->ai.ai_protocol = hints->ai_protocol;
    b->ai.ai_addrlen = sizeof b->sa;
    b->ai.ai_addr = (struct sockaddr*)&b->sa;
    *res = &b->ai;
  }
  return 0;
}

// ---------------- callbacks (hilos de libdatachannel) ----------------

static void RTC_API
on_desc(int pc, const char *sdp, const char *type, void *p) { emit(p, R_DESC, pc, 0, sdp, strlen(sdp), type, 0); }
static void RTC_API
on_cand(int pc, const char *c, const char *mid, void *p) { emit(p, R_CAND, pc, 0, c, strlen(c), mid ? mid : "0", 0); }
static void RTC_API
on_state(int pc, rtcState s, void *p) {
  if((unsigned)s < sizeof STATE / sizeof *STATE) emit(p, R_STATE, pc, 0, NULL, 0, STATE[s], 0);
}
static void RTC_API
on_gather(int pc, rtcGatheringState s, void *p) { if(s == RTC_GATHERING_COMPLETE) emit(p, R_GATHER, pc, 0, NULL, 0, "complete", 0); }
static void RTC_API
on_open(int dc, void *p) { emit(p, R_OPEN, dc, 0, NULL, 0, NULL, 0); }
static void RTC_API
on_closed(int dc, void *p) { emit(p, R_CLOSE, dc, 0, NULL, 0, NULL, 0); }
static void RTC_API
on_error(int dc, const char *err, void *p) { emit(p, R_ERR, dc, 0, err, strlen(err), NULL, 0); }
static void RTC_API
on_msg(int dc, const char *m, int size, void *p) {
  // size < 0: texto acabado en 0.
  if(size < 0) emit(p, R_MSG, dc, 0, m, strlen(m), NULL, 0);
  else emit(p, R_MSG, dc, 0, m, (size_t)size, NULL, 1);
}

static void
wire_dc(int dc, void *gen) {
  rtcSetUserPointer(dc, gen);
  rtcSetOpenCallback(dc, on_open);
  rtcSetClosedCallback(dc, on_closed);
  rtcSetErrorCallback(dc, on_error);
  rtcSetMessageCallback(dc, on_msg);
}

static void RTC_API
on_dc(int pc, int dc, void *p) {
  char label[64] = "";
  if((intptr_t)p != rtc_gen) return;
  rtcGetDataChannelLabel(dc, label, sizeof label);
  // Primero el canal y luego sus callbacks: libdatachannel guarda el "abierto" y los mensajes y los da al poner
  // el callback, y el JS tiene que conocer el canal antes.
  emit(p, R_DC, pc, dc, NULL, 0, label, 0);
  wire_dc(dc, p);
}

static void RTC_API
on_log(rtcLogLevel level, const char *msg) { if(say) say("[rtc] %s\n", msg); }

// ---------------- lo que ve el JS ----------------

static int
num(JSContext *ctx, JSValueConst v) { int i = 0; JS_ToInt32(ctx, &i, v); return i; }

static void
forget_pc(int pc) {
  for(int i = 0; i < n_pcs; i++) if(pcs[i] == pc) { pcs[i] = pcs[--n_pcs]; return; }
}

static JSValue
r_pc(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  rtcConfiguration cfg;
  const char *srv[8], *list = JS_ToCString(ctx, argv[0]);
  char *buf = list ? strdup(list) : NULL, *save = NULL;
  int n = 0, pc;
  if(list) JS_FreeCString(ctx, list);
  if(n_pcs >= MAX_PC) { free(buf); return JS_NewInt32(ctx, -1); }
  for(char *t = buf ? strtok_r(buf, "\n", &save) : NULL; t && n < 8; t = strtok_r(NULL, "\n", &save)) if(*t) srv[n++] = t;
  memset(&cfg, 0, sizeof cfg);
  cfg.iceServers = srv; cfg.iceServersCount = n;
  // libjuice pide la dirección "cualquiera" con getaddrinfo(NULL, "0", AI_PASSIVE), que en la PS5 falla: sin
  // puerto UDP no hay candidatos. Escrita, sí la da (sólo IPv4).
  cfg.bindAddress = "0.0.0.0";
  cfg.disableAutoNegotiation = true;   // la oferta y la respuesta las pide el JS (createOffer / createAnswer)
  pc = rtcCreatePeerConnection(&cfg);
  free(buf);
  if(pc < 0) { say("[rtc] no se pudo crear la conexión (%d)\n", pc); return JS_NewInt32(ctx, -1); }
  rtcSetUserPointer(pc, (void*)rtc_gen);
  rtcSetLocalDescriptionCallback(pc, on_desc);
  rtcSetLocalCandidateCallback(pc, on_cand);
  rtcSetStateChangeCallback(pc, on_state);
  rtcSetGatheringStateChangeCallback(pc, on_gather);
  rtcSetDataChannelCallback(pc, on_dc);
  pcs[n_pcs++] = pc;
  return JS_NewInt32(ctx, pc);
}

static JSValue
r_close_pc(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int pc = num(ctx, argv[0]);
  forget_pc(pc);
  rtcDeletePeerConnection(pc);   // cierra y suelta también sus canales
  return JS_UNDEFINED;
}

static JSValue
r_dc(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *label = JS_ToCString(ctx, argv[1]);
  int dc = label ? rtcCreateDataChannel(num(ctx, argv[0]), label) : -1;
  if(label) JS_FreeCString(ctx, label);
  if(dc >= 0) wire_dc(dc, (void*)rtc_gen);
  return JS_NewInt32(ctx, dc < 0 ? -1 : dc);
}

static JSValue
r_close_dc(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  rtcClose(num(ctx, argv[0]));
  return JS_UNDEFINED;
}

static JSValue
r_local(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *type = JS_ToCString(ctx, argv[1]);
  int rc = type ? rtcSetLocalDescription(num(ctx, argv[0]), type) : -1;
  if(type) JS_FreeCString(ctx, type);
  return JS_NewBool(ctx, rc >= 0);
}

static JSValue
r_remote(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *sdp = JS_ToCString(ctx, argv[1]), *type = JS_ToCString(ctx, argv[2]);
  int rc = sdp && type ? rtcSetRemoteDescription(num(ctx, argv[0]), sdp, type) : -1;
  if(sdp) JS_FreeCString(ctx, sdp);
  if(type) JS_FreeCString(ctx, type);
  return JS_NewBool(ctx, rc >= 0);
}

static JSValue
r_cand(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *c = JS_ToCString(ctx, argv[1]), *mid = JS_IsString(argv[2]) ? JS_ToCString(ctx, argv[2]) : NULL;
  int rc = c ? rtcAddRemoteCandidate(num(ctx, argv[0]), c, mid) : -1;
  if(c) JS_FreeCString(ctx, c);
  if(mid) JS_FreeCString(ctx, mid);
  return JS_NewBool(ctx, rc >= 0);
}

static JSValue
r_send(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int dc = num(ctx, argv[0]), rc;
  size_t len;
  uint8_t *b = JS_GetArrayBuffer(ctx, &len, argv[1]);
  if(b) rc = rtcSendMessage(dc, (const char*)b, (int)len);
  else {
    const char *s;
    JS_FreeValue(ctx, JS_GetException(ctx));
    if(!(s = JS_ToCString(ctx, argv[1]))) return JS_FALSE;
    rc = rtcSendMessage(dc, s, -1);   // < 0: texto
    JS_FreeCString(ctx, s);
  }
  return JS_NewBool(ctx, rc >= 0);
}

// Lo que queda por salir en el canal (RTCDataChannel.bufferedAmount: coop.js espera si hay mucho).
static JSValue
r_buffered(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int n = rtcGetBufferedAmount(num(ctx, argv[0]));
  return JS_NewInt32(ctx, n < 0 ? 0 : n);
}

static JSValue
r_poll(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  rev_t *e;
  JSValue list = JS_NewArray(ctx);
  uint32_t i = 0;
  pthread_mutex_lock(&q_mx);
  e = q_head; q_head = q_tail = NULL;
  pthread_mutex_unlock(&q_mx);
  while(e) {
    rev_t *n = e->next;
    JSValue it = JS_NewArray(ctx);
    uint32_t k = 0;
    JS_SetPropertyUint32(ctx, it, k++, JS_NewString(ctx, R_NAME[e->kind]));
    JS_SetPropertyUint32(ctx, it, k++, JS_NewInt32(ctx, e->id));
    if(e->kind == R_DC) JS_SetPropertyUint32(ctx, it, k++, JS_NewInt32(ctx, e->id2));
    if(e->a) JS_SetPropertyUint32(ctx, it, k++, e->bin ? JS_NewArrayBufferCopy(ctx, (uint8_t*)e->a, e->len)
                                                        : JS_NewStringLen(ctx, e->a, e->len));
    if(e->b) JS_SetPropertyUint32(ctx, it, k++, JS_NewString(ctx, e->b));
    JS_SetPropertyUint32(ctx, list, i++, it);
    free(e->a); free(e->b); free(e);
    e = n;
  }
  return list;
}

void
rtc_reset(void) {
  rtc_gen++;
  while(n_pcs) rtcDeletePeerConnection(pcs[--n_pcs]);
  pthread_mutex_lock(&q_mx);
  while(q_head) { rev_t *e = q_head; q_head = e->next; free(e->a); free(e->b); free(e); }
  q_tail = NULL;
  pthread_mutex_unlock(&q_mx);
}

void
rtc_init(JSContext *ctx, JSValue ps, void (*log)(const char *fmt, ...)) {
  static int started;
  say = log;
  if(!started) { started = 1; rtcInitLogger(RTC_LOG_WARNING, on_log); }
#define RFN(name, fn, n) JS_SetPropertyStr(ctx, ps, name, JS_NewCFunction(ctx, fn, name, n))
  RFN("rtc_pc", r_pc, 1);
  RFN("rtc_close_pc", r_close_pc, 1);
  RFN("rtc_dc", r_dc, 2);
  RFN("rtc_close_dc", r_close_dc, 1);
  RFN("rtc_local", r_local, 2);
  RFN("rtc_remote", r_remote, 3);
  RFN("rtc_cand", r_cand, 3);
  RFN("rtc_send", r_send, 2);
  RFN("rtc_buffered", r_buffered, 1);
  RFN("rtc_poll", r_poll, 0);
}
