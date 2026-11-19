/* net.c — HTTP(S) y WebSocket para el JS (fetch, XMLHttpRequest y WebSocket de native/shim/net.js).
 *
 * Con libcurl + OpenSSL del SDK, fuera del hilo del juego:
 *   - las peticiones HTTP, todas en un hilo con curl_multi; la respuesta llega por trozos según se recibe
 *     (Firestore, en long-polling, va leyendo la respuesta a medias, como en el navegador);
 *   - cada WebSocket, en su propio hilo (curl_ws_*, modo CONNECT_ONLY).
 * El JS lo recoge todo en cada fotograma con ps.net_poll(): una lista de eventos.
 *
 *   ps.net_request(id, método, url, cabeceras "K: V\n...", cuerpo|null, ms)
 *   ps.net_abort(id)
 *   ps.net_ws_open(id, url, protocolos, origen)  ps.net_ws_send(id, texto|ArrayBuffer)  ps.net_ws_close(id, código)
 *   ps.net_poll() -> [[tipo, id, ...], ...]
 *     ['head', id, estado, cabeceras, urlFinal]  ['data', id, trozo]  ['done', id]  ['err', id, mensaje]
 *     ['ws_open', id, protocolo]  ['ws_msg', id, texto|ArrayBuffer]  ['ws_close', id, código, motivo]
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#include <winsock2.h>
#else
#include <sys/select.h>
#endif
#include <curl/curl.h>

#include "quickjs.h"
#include "net.h"

static void (*say)(const char *fmt, ...);
static char cainfo[600];

// ---------------- eventos hacia el JS ----------------

typedef struct ev {
  struct ev *next;
  int kind, id, status, bin, gen;
  char *a, *b;        // texto (o bytes, con len)
  size_t len;
} ev_t;

#undef EV_ERR   // (Windows: winbase.h lo usa para los puertos serie)
enum { EV_HEAD, EV_DATA, EV_DONE, EV_ERR, EV_WS_OPEN, EV_WS_MSG, EV_WS_CLOSE };
static const char *EV_NAME[] = { "head", "data", "done", "err", "ws_open", "ws_msg", "ws_close" };

static ev_t *ev_head, *ev_tail;
// Sube al recargar (net_reset): los eventos de peticiones y sockets de antes se tiran.
static volatile int net_gen;
static pthread_mutex_t ev_mx = PTHREAD_MUTEX_INITIALIZER;

static char*
dupn(const char *s, size_t n) {
  char *d = malloc(n + 1);
  if(d) { if(n) memcpy(d, s, n); d[n] = 0; }
  return d;
}

static void
emit_g(int gen, int kind, int id, int status, const char *a, size_t alen, const char *b, int bin) {
  ev_t *e;
  if(gen != net_gen || !(e = calloc(1, sizeof *e))) return;
  e->kind = kind; e->id = id; e->status = status; e->bin = bin; e->gen = gen;
  if(a) { e->a = dupn(a, alen); e->len = alen; }
  if(b) e->b = dupn(b, strlen(b));
  pthread_mutex_lock(&ev_mx);
  if(ev_tail) ev_tail->next = e; else ev_head = e;
  ev_tail = e;
  pthread_mutex_unlock(&ev_mx);
}

// ---------------- HTTP ----------------

typedef struct req {
  struct req *next;
  int id, timeout_ms, aborted, head_sent, gen;
  char *method, *url, *body;
  size_t body_len;
  struct curl_slist *hdrs;
  CURL *easy;
  char *rh; size_t rh_len, rh_cap;   // cabeceras de la respuesta
  char carry[4]; size_t carry_len;   // el final de un carácter UTF-8 cortado entre dos trozos
} req_t;

static req_t *pending, *active;        // por empezar (los mete el JS) y en marcha (sólo el hilo)
static int abort_ids[256], n_aborts;
static pthread_mutex_t rq_mx = PTHREAD_MUTEX_INITIALIZER;
static CURLM *multi;

static void
req_free(req_t *r) {
  if(r->easy) curl_easy_cleanup(r->easy);
  curl_slist_free_all(r->hdrs);
  free(r->method); free(r->url); free(r->body); free(r->rh);
  free(r);
}

static void
send_head(req_t *r) {
  long code = 0;
  char *url = NULL;
  if(r->head_sent) return;
  r->head_sent = 1;
  curl_easy_getinfo(r->easy, CURLINFO_RESPONSE_CODE, &code);
  curl_easy_getinfo(r->easy, CURLINFO_EFFECTIVE_URL, &url);
  emit_g(r->gen, EV_HEAD, r->id, (int)code, r->rh ? r->rh : "", r->rh_len, url ? url : r->url, 0);
}

static size_t
on_header(char *p, size_t sz, size_t n, void *ud) {
  req_t *r = ud;
  size_t len = sz * n;
  // Una línea de estado nueva (redirección, 100 Continue): empiezan sus cabeceras.
  if(len > 5 && !strncmp(p, "HTTP/", 5)) r->rh_len = 0;
  else if(len > 2) {
    if(r->rh_len + len + 1 > r->rh_cap) {
      size_t cap = (r->rh_len + len + 1) * 2;
      char *q = realloc(r->rh, cap);
      if(!q) return 0;
      r->rh = q; r->rh_cap = cap;
    }
    memcpy(r->rh + r->rh_len, p, len);
    r->rh_len += len;
    r->rh[r->rh_len] = 0;
  }
  return len;
}

// Cuántos bytes del final de p son un carácter UTF-8 a medias (0-3): ésos esperan al trozo siguiente,
// porque el JS recibe cada trozo como texto y un carácter partido se estropearía.
static size_t
utf8_tail(const char *p, size_t len) {
  for(size_t k = 1; k <= 3 && k <= len; k++) {
    unsigned char c = (unsigned char)p[len - k];
    if((c & 0xc0) == 0x80) continue;          // byte de continuación: seguir mirando atrás
    size_t need = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1;
    return need > k ? k : 0;
  }
  return 0;
}

static size_t
on_body(char *p, size_t sz, size_t n, void *ud) {
  req_t *r = ud;
  size_t len = sz * n, tail;
  char *buf;
  send_head(r);
  if(!len) return 0;
  if(!(buf = malloc(r->carry_len + len))) return 0;
  memcpy(buf, r->carry, r->carry_len);
  memcpy(buf + r->carry_len, p, len);
  len += r->carry_len;
  tail = utf8_tail(buf, len);
  memcpy(r->carry, buf + len - tail, tail);
  r->carry_len = tail;
  if(len > tail) emit_g(r->gen, EV_DATA, r->id, 0, buf, len - tail, NULL, 0);
  free(buf);
  return sz * n;
}

// Título: el nombre del servidor, resuelto ya (ver title_resolve en title/compat.c) y fijado con CURLOPT_RESOLVE, para
// que curl no use su hilo de DNS. Recordado 5 min por servidor. Con candado: lo usan el hilo de red, el del WebSocket y el
// de las actualizaciones (update.c).
#ifdef PS5_TITLE
int title_resolve(const char *host, char *ip, size_t len);
// El candado sólo cubre la caché, nunca el DNS: con él cogido durante title_resolve, un nombre que no contestaba (a los 5
// min, al caducar) dejaba parados a la vez el hilo de red, el del WebSocket y el de las actualizaciones (13-11-2026: el
// ranking y la vuelta al menú, colgados). title_resolve ya tiene su propia caché y su candado.
static void
pin_host(CURL *e, const char *url) {
  static pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
  static struct { char host[128], ip[16]; double at; } cache[16];
  static struct curl_slist *lists[64];
  static int nlists;
  char host[128] = "", ip[16] = "";
  int port = !strncmp(url, "http://", 7) || !strncmp(url, "ws://", 5) ? 80 : 443;
  const char *h = strstr(url, "://");
  if(!h) return;
  h += 3;
  size_t n = strcspn(h, ":/?#");
  if(!n || n >= sizeof host) return;
  memcpy(host, h, n); host[n] = 0;
  if(h[n] == ':') port = atoi(h + n + 1);
  struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
  double now = ts.tv_sec;
  pthread_mutex_lock(&m);
  for(int i = 0; i < 16; i++) if(!strcmp(cache[i].host, host) && now - cache[i].at < 300) { memcpy(ip, cache[i].ip, sizeof ip); break; }
  pthread_mutex_unlock(&m);
  if(!ip[0]) {
    if(title_resolve(host, ip, sizeof ip)) return;   // que lo intente curl
    pthread_mutex_lock(&m);
    int slot = 0;
    for(int i = 1; i < 16; i++) if(cache[i].at < cache[slot].at) slot = i;
    snprintf(cache[slot].host, sizeof cache[slot].host, "%s", host);
    snprintf(cache[slot].ip, sizeof cache[slot].ip, "%s", ip);
    cache[slot].at = now;
    pthread_mutex_unlock(&m);
  }
  char entry[200];
  snprintf(entry, sizeof entry, "%s:%d:%s", host, port, ip);
  // (curl no copia la lista: vive hasta que se reutiliza el hueco, mucho después de que la petición acabe)
  pthread_mutex_lock(&m);
  struct curl_slist **l = &lists[nlists++ % 64];
  curl_slist_free_all(*l);
  *l = curl_slist_append(NULL, entry);
  curl_easy_setopt(e, CURLOPT_RESOLVE, *l);
  pthread_mutex_unlock(&m);
}
#else
#define pin_host(e, url) ((void)0)
#endif

// Lo mismo que una petición del juego (update.c, desde su hilo): los certificados de cacert.pem y, en el título, el DNS propio.
void
net_easy_setup(void *e, const char *url) {
  pin_host(e, url);
  if(cainfo[0]) curl_easy_setopt(e, CURLOPT_CAINFO, cainfo);
}

// Diagnóstico (ps.net_debug): vueltas del hilo y en qué paso está ahora (si no avanza, dónde se ha quedado).
static volatile unsigned long http_loops;
static const char *volatile http_phase = "sin empezar";

static void
start(req_t *r) {
  CURL *e = curl_easy_init();
  if(!e) { emit_g(r->gen, EV_ERR, r->id, 0, "curl", 4, NULL, 0); req_free(r); return; }
  r->easy = e;
  curl_easy_setopt(e, CURLOPT_URL, r->url);
  http_phase = "dns (pin_host)";
  pin_host(e, r->url);
  http_phase = "arrancando (curl)";
  curl_easy_setopt(e, CURLOPT_PRIVATE, r);
  curl_easy_setopt(e, CURLOPT_HTTPHEADER, r->hdrs);
  curl_easy_setopt(e, CURLOPT_HEADERFUNCTION, on_header);
  curl_easy_setopt(e, CURLOPT_HEADERDATA, r);
  curl_easy_setopt(e, CURLOPT_WRITEFUNCTION, on_body);
  curl_easy_setopt(e, CURLOPT_WRITEDATA, r);
  curl_easy_setopt(e, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(e, CURLOPT_ACCEPT_ENCODING, "");    // gzip/deflate/zstd, como el navegador
  curl_easy_setopt(e, CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(e, CURLOPT_CONNECTTIMEOUT_MS, 15000L);
  if(r->timeout_ms > 0) curl_easy_setopt(e, CURLOPT_TIMEOUT_MS, (long)r->timeout_ms);
  if(cainfo[0]) curl_easy_setopt(e, CURLOPT_CAINFO, cainfo);
  if(!strcmp(r->method, "GET")) curl_easy_setopt(e, CURLOPT_HTTPGET, 1L);
  else if(!strcmp(r->method, "HEAD")) curl_easy_setopt(e, CURLOPT_NOBODY, 1L);
  else {
    curl_easy_setopt(e, CURLOPT_CUSTOMREQUEST, r->method);
    if(r->body || strcmp(r->method, "DELETE")) {
      curl_easy_setopt(e, CURLOPT_POSTFIELDSIZE_LARGE, (curl_off_t)r->body_len);
      curl_easy_setopt(e, CURLOPT_POSTFIELDS, r->body ? r->body : "");
    }
  }
  r->next = active; active = r;
  curl_multi_add_handle(multi, e);
}

static void
finish(req_t *r, CURLcode rc) {
  req_t **pp = &active;
  while(*pp && *pp != r) pp = &(*pp)->next;
  if(*pp) *pp = r->next;
  curl_multi_remove_handle(multi, r->easy);
  if(!r->aborted) {
    if(rc == CURLE_OK) {
      send_head(r);
      if(r->carry_len) emit_g(r->gen, EV_DATA, r->id, 0, r->carry, r->carry_len, NULL, 0);   // lo que quedara (UTF-8 mal formado)
      emit_g(r->gen, EV_DONE, r->id, 0, NULL, 0, NULL, 0);
    }
    else { const char *m = curl_easy_strerror(rc); emit_g(r->gen, EV_ERR, r->id, (int)rc, m, strlen(m), NULL, 0); }
  }
  req_free(r);
}


static void*
http_thread(void *arg) {
  for(;;) {
    http_loops++;
    http_phase = "cola";
    int still, msgs;
    CURLMsg *m;
    req_t *todo;
    pthread_mutex_lock(&rq_mx);
    todo = pending; pending = NULL;
    for(int i = 0; i < n_aborts; i++)
      for(req_t *r = active; r; r = r->next) if(r->id == abort_ids[i]) r->aborted = 1;
    for(req_t *r = active; r; r = r->next) if(r->gen != net_gen) r->aborted = 1;   // de antes de recargar
    n_aborts = 0;
    pthread_mutex_unlock(&rq_mx);
    // El orden en que llegaron (la lista se llena al revés).
    { req_t *rev = NULL; while(todo) { req_t *n = todo->next; todo->next = rev; rev = todo; todo = n; } todo = rev; }
    http_phase = "arrancando (dns, conexión)";
    while(todo) { req_t *n = todo->next; start(todo); todo = n; }
    http_phase = "cerrando las canceladas";
    for(req_t *r = active, *n; r; r = n) { n = r->next; if(r->aborted) finish(r, CURLE_ABORTED_BY_CALLBACK); }

    http_phase = "curl_multi_perform";
    curl_multi_perform(multi, &still);
    http_phase = "terminadas";
    while((m = curl_multi_info_read(multi, &msgs))) {
      if(m->msg != CURLMSG_DONE) continue;
      req_t *r = NULL;
      curl_easy_getinfo(m->easy_handle, CURLINFO_PRIVATE, (char**)&r);
#ifdef PS5_TITLE
      {   // ponytail: diagnóstico del título: en qué fase se va el tiempo (ms acumulados)
        curl_off_t dns = 0, con = 0, tls = 0, first = 0, total = 0;
        curl_easy_getinfo(m->easy_handle, CURLINFO_NAMELOOKUP_TIME_T, &dns);
        curl_easy_getinfo(m->easy_handle, CURLINFO_CONNECT_TIME_T, &con);
        curl_easy_getinfo(m->easy_handle, CURLINFO_APPCONNECT_TIME_T, &tls);
        curl_easy_getinfo(m->easy_handle, CURLINFO_STARTTRANSFER_TIME_T, &first);
        curl_easy_getinfo(m->easy_handle, CURLINFO_TOTAL_TIME_T, &total);
        // CPU que lleva gastado este hilo (desde el anterior): si es casi el total, el tiempo se va en calcular;
        // si es poco, en esperar (dormido o sin turno).
        static double cpu_prev;
        struct timespec ts;
        clock_gettime(CLOCK_THREAD_CPUTIME_ID, &ts);
        double cpu = ts.tv_sec * 1e3 + ts.tv_nsec / 1e6;
        say("[red] tiempos: dns %ld · conexión %ld · tls %ld · primer byte %ld · total %ld ms · CPU del hilo %.0f ms\n",
            (long)(dns / 1000), (long)(con / 1000), (long)(tls / 1000), (long)(first / 1000), (long)(total / 1000), cpu - cpu_prev);
        cpu_prev = cpu;
      }
#endif
      if(r) finish(r, m->data.result);
    }
    http_phase = "poll";
#ifdef PS5_TITLE
    curl_multi_poll(multi, NULL, 0, 20, NULL);   // título: curl_multi_wakeup (un socketpair) no despierta: se mira cada 20 ms
#else
    curl_multi_poll(multi, NULL, 0, 1000, NULL);   // hasta que haya algo, o curl_multi_wakeup
#endif
  }
  return NULL;
}

// ---------------- WebSocket ----------------

typedef struct out { struct out *next; char *data; size_t len; int bin; } out_t;

typedef struct ws {
  struct ws *next;
  int id, closing, close_code, gen;
  char *url, *protocols, *origin;
  out_t *out, *out_tail;
  pthread_mutex_t mx;
} ws_t;

static ws_t *sockets;
static pthread_mutex_t ws_mx = PTHREAD_MUTEX_INITIALIZER;

// Con ws_mx cogido (así ws_forget no lo libera mientras se usa).
static ws_t*
ws_find_locked(int id) {
  ws_t *w;
  for(w = sockets; w && w->id != id; w = w->next);
  return w;
}

static void
ws_forget(ws_t *w) {
  pthread_mutex_lock(&ws_mx);
  for(ws_t **pp = &sockets; *pp; pp = &(*pp)->next) if(*pp == w) { *pp = w->next; break; }
  pthread_mutex_unlock(&ws_mx);
  while(w->out) { out_t *o = w->out; w->out = o->next; free(o->data); free(o); }
  pthread_mutex_destroy(&w->mx);
  free(w->url); free(w->protocols); free(w->origin); free(w);
}

// Manda todo lo de un trozo (curl_ws_send puede mandar sólo una parte).
static CURLcode
ws_send_all(CURL *e, const char *p, size_t len, unsigned flags) {
  size_t off = 0;
  while(off < len || (!len && !off)) {
    size_t sent = 0;
    CURLcode rc = curl_ws_send(e, p + off, len - off, &sent, 0, flags);
#ifdef _WIN32
    if(rc == CURLE_AGAIN) { Sleep(5); continue; }   // (select sin sockets no espera en Windows)
#else
    if(rc == CURLE_AGAIN) { struct timeval tv = { 0, 5000 }; select(0, NULL, NULL, NULL, &tv); continue; }
#endif
    if(rc != CURLE_OK) return rc;
    off += sent;
    if(!len) break;
  }
  return CURLE_OK;
}

#ifdef PS5_TITLE
// Diagnóstico (ps.net_debug): el hilo del WebSocket, en qué paso está y desde cuándo.
static pthread_t ws_tid;
static const char *volatile ws_phase = "sin abrir";
static volatile double ws_since;
static double mono_s(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }
#endif

#ifdef PS5_TITLE
// ponytail: diagnóstico del título (el WebSocket de las salas se queda «conectando» 30 s): cada paso de curl, con
// los ms desde que empezó (TCP, TLS, la petición y la primera línea de la respuesta, «101 Switching Protocols»).
// Con say (a un búfer): un fprintf(stderr) cuesta ~40 ms en la consola y falseaba lo que se medía.
static int
ws_trace(CURL *e, curl_infotype t, char *d, size_t n, void *u) {
  (void)e;
  if(!say || (t != CURLINFO_TEXT && t != CURLINFO_HEADER_IN && t != CURLINFO_HEADER_OUT)) return 0;
  if(t != CURLINFO_TEXT && *(int*)u & (t == CURLINFO_HEADER_IN ? 1 : 2)) return 0;   // de las cabeceras, sólo la primera línea
  if(t != CURLINFO_TEXT) *(int*)u |= t == CURLINFO_HEADER_IN ? 1 : 2;
  size_t l = strcspn(d, "\r\n");
  say("[ws] %.0f ms %s%.*s\n", (mono_s() - ws_since) * 1000, t == CURLINFO_HEADER_IN ? "← " : t == CURLINFO_HEADER_OUT ? "→ " : "",
          (int)(l < n ? l : n > 160 ? 160 : n), d);
  return 0;
}
#endif

static void*
ws_thread(void *arg) {
  ws_t *w = arg;
  CURL *e = curl_easy_init();
  struct curl_slist *h = NULL;
  char hdr[600], *msg = NULL;
  size_t msg_len = 0, msg_cap = 0;
  int code = 1006, msg_bin = 0;
  const char *reason = "";
  curl_socket_t sock;
  CURLcode rc;

  if(!e) { emit_g(w->gen, EV_WS_CLOSE, w->id, 1006, "", 0, "curl", 0); ws_forget(w); return NULL; }
#ifdef PS5_TITLE
  ws_tid = pthread_self(); ws_phase = "conectando"; ws_since = mono_s();
#endif
  // El origen de la web del servidor (net.js, de PS_ENV.hosts): el Worker de las salas lo puede comprobar.
  snprintf(hdr, sizeof hdr, "Origin: %s", w->origin && *w->origin ? w->origin : "https://pokesurvivor.com");
  h = curl_slist_append(h, hdr);
  if(w->protocols && *w->protocols) { snprintf(hdr, sizeof hdr, "Sec-WebSocket-Protocol: %s", w->protocols); h = curl_slist_append(h, hdr); }
  curl_easy_setopt(e, CURLOPT_URL, w->url);
#ifdef PS5_TITLE
  if(say) say("[ws] hilo en marcha a los %.0f ms; resolviendo el nombre\n", (mono_s() - ws_since) * 1000);   // ponytail: diagnóstico
#endif
  pin_host(e, w->url);
#ifdef PS5_TITLE
  if(say) say("[ws] nombre resuelto a los %.0f ms\n", (mono_s() - ws_since) * 1000);
#endif
  curl_easy_setopt(e, CURLOPT_CONNECT_ONLY, 2L);
  curl_easy_setopt(e, CURLOPT_HTTPHEADER, h);
  curl_easy_setopt(e, CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(e, CURLOPT_CONNECTTIMEOUT_MS, 15000L);
  if(cainfo[0]) curl_easy_setopt(e, CURLOPT_CAINFO, cainfo);
#ifdef PS5_TITLE
  int seen = 0;
  curl_easy_setopt(e, CURLOPT_DEBUGFUNCTION, ws_trace);
  curl_easy_setopt(e, CURLOPT_DEBUGDATA, &seen);
  curl_easy_setopt(e, CURLOPT_VERBOSE, 1L);
#endif
  if((rc = curl_easy_perform(e)) != CURLE_OK) { reason = curl_easy_strerror(rc); goto out; }
  curl_easy_getinfo(e, CURLINFO_ACTIVESOCKET, &sock);
#ifdef PS5_TITLE
  ws_phase = "abierto";
#endif
  emit_g(w->gen, EV_WS_OPEN, w->id, 0, "", 0, w->protocols ? w->protocols : "", 0);

  for(;;) {
    // Lo que hay que mandar.
    out_t *o;
    pthread_mutex_lock(&w->mx);
    o = w->out; w->out = w->out_tail = NULL;
    int closing = w->closing;
    pthread_mutex_unlock(&w->mx);
    while(o) {
      out_t *n = o->next;
      if(ws_send_all(e, o->data, o->len, o->bin ? CURLWS_BINARY : CURLWS_TEXT) != CURLE_OK) reason = "send";
      free(o->data); free(o); o = n;
    }
    if(closing) {
      unsigned char p[2] = { (unsigned char)(w->close_code >> 8), (unsigned char)w->close_code };
      ws_send_all(e, (const char*)p, 2, CURLWS_CLOSE);
      code = w->close_code; reason = "";
      break;
    }
    // Lo que llega (con espera corta, para mirar la cola de salida a menudo). Se lee aunque el socket no tenga nada nuevo:
    // curl puede tenerlo ya en su búfer. El saludo de Firebase llegaba en el mismo paquete que el «101» del WebSocket: el
    // socket ya no avisaba, nadie lo leía, el SDK esperaba el saludo y a los 30 s cerraba («Esa sala ya no existe», 02-11-2026).
    fd_set rf;
    struct timeval tv = { 0, 20000 };
    FD_ZERO(&rf); FD_SET(sock, &rf);
    select(sock + 1, &rf, NULL, NULL, &tv);
    for(;;) {
      char buf[16384];
      size_t got = 0;
      const struct curl_ws_frame *f = NULL;
      rc = curl_ws_recv(e, buf, sizeof buf, &got, &f);
      if(rc == CURLE_AGAIN) break;
      if(rc != CURLE_OK) { reason = curl_easy_strerror(rc); goto out; }
      if(f->flags & CURLWS_CLOSE) {
        code = got >= 2 ? ((unsigned char)buf[0] << 8 | (unsigned char)buf[1]) : 1005;
        reason = "";
        goto out;
      }
      if(f->flags & CURLWS_PING) continue;   // curl contesta solo con el pong
      if(!(f->flags & (CURLWS_TEXT | CURLWS_BINARY | CURLWS_CONT))) continue;
      if(msg_len + got + 1 > msg_cap) {
        size_t cap = (msg_len + got + 1) * 2;
        char *q = realloc(msg, cap);
        if(!q) { reason = "memoria"; goto out; }
        msg = q; msg_cap = cap;
      }
      memcpy(msg + msg_len, buf, got);
      msg_len += got;
      if(f->flags & CURLWS_BINARY) msg_bin = 1;
      // Mensaje completo: ni más bytes de este trozo ni más trozos.
      if(!f->bytesleft && !(f->flags & CURLWS_CONT)) {
        emit_g(w->gen, EV_WS_MSG, w->id, 0, msg, msg_len, NULL, msg_bin);
        msg_len = 0; msg_bin = 0;
      }
    }
  }
out:
  emit_g(w->gen, EV_WS_CLOSE, w->id, code, "", 0, reason, 0);
  free(msg);
  curl_slist_free_all(h);
  curl_easy_cleanup(e);
  ws_forget(w);
  return NULL;
}

// ---------------- lo que ve el JS ----------------

static int
num(JSContext *ctx, JSValueConst v) { int i = 0; JS_ToInt32(ctx, &i, v); return i; }

static char*
str(JSContext *ctx, JSValueConst v, size_t *len) {
  size_t n = 0;
  const char *s;
  char *d;
  if(JS_IsNull(v) || JS_IsUndefined(v)) { if(len) *len = 0; return NULL; }
  {
    size_t bl;
    uint8_t *b = JS_GetArrayBuffer(ctx, &bl, v);
    if(b) { if(len) *len = bl; return dupn((const char*)b, bl); }
    JS_FreeValue(ctx, JS_GetException(ctx));
  }
  s = JS_ToCStringLen(ctx, &n, v);
  if(!s) return NULL;
  d = dupn(s, n);
  JS_FreeCString(ctx, s);
  if(len) *len = n;
  return d;
}

static JSValue
n_request(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  req_t *r = calloc(1, sizeof *r);
  char *hs, *line, *save = NULL;
  if(!r) return JS_FALSE;
  r->id = num(ctx, argv[0]);
  r->gen = net_gen;
  r->method = str(ctx, argv[1], NULL);
  r->url = str(ctx, argv[2], NULL);
  hs = str(ctx, argv[3], NULL);
  r->body = argc > 4 ? str(ctx, argv[4], &r->body_len) : NULL;
  r->timeout_ms = argc > 5 ? num(ctx, argv[5]) : 0;
  if(!r->method || !r->url) { free(hs); req_free(r); return JS_FALSE; }
  // Sin "Expect: 100-continue" (curl lo pone en los POST grandes) ni cabeceras vacías.
  r->hdrs = curl_slist_append(r->hdrs, "Expect:");
  for(line = hs ? strtok_r(hs, "\n", &save) : NULL; line; line = strtok_r(NULL, "\n", &save))
    if(*line) r->hdrs = curl_slist_append(r->hdrs, line);
  free(hs);
  pthread_mutex_lock(&rq_mx);
  r->next = pending; pending = r;
  pthread_mutex_unlock(&rq_mx);
  curl_multi_wakeup(multi);
  return JS_TRUE;
}

static JSValue
n_abort(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int id = num(ctx, argv[0]);
  pthread_mutex_lock(&rq_mx);
  // Aún sin empezar: se quita de la cola. En marcha: lo corta el hilo.
  for(req_t **pp = &pending; *pp; pp = &(*pp)->next)
    if((*pp)->id == id) { req_t *r = *pp; *pp = r->next; req_free(r); pthread_mutex_unlock(&rq_mx); return JS_UNDEFINED; }
  if(n_aborts < 256) abort_ids[n_aborts++] = id;
  pthread_mutex_unlock(&rq_mx);
  curl_multi_wakeup(multi);
  return JS_UNDEFINED;
}

static JSValue
n_ws_open(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  ws_t *w = calloc(1, sizeof *w);
  pthread_t t;
  if(!w) return JS_FALSE;
  w->id = num(ctx, argv[0]);
  w->gen = net_gen;
  w->url = str(ctx, argv[1], NULL);
  w->protocols = argc > 2 ? str(ctx, argv[2], NULL) : NULL;
  w->origin = argc > 3 ? str(ctx, argv[3], NULL) : NULL;
  pthread_mutex_init(&w->mx, NULL);
  if(!w->url) { pthread_mutex_destroy(&w->mx); free(w->protocols); free(w->origin); free(w); return JS_FALSE; }
  pthread_mutex_lock(&ws_mx);
  w->next = sockets; sockets = w;
  pthread_mutex_unlock(&ws_mx);
  if(pthread_create(&t, NULL, ws_thread, w)) { ws_forget(w); return JS_FALSE; }
  pthread_detach(t);
  return JS_TRUE;
}

/* ---------------- la partida de la web (escritorio: Ajustes → Cuenta → «Traer mi partida de la web») ----------------
 * ps.net_inbox(nonce, origen) → puerto (0 si no se pudo): escucha en 127.0.0.1 un POST /<nonce> que sólo puede venir de
 *   la página de <origen> (el navegador manda Origin); el cuerpo (JSON de la partida, hasta 8 MB) queda guardado.
 * ps.net_inbox_take() → ese cuerpo (texto) una sola vez, o null. Un hilo; se cierra con lo primero válido o a los 10 min.
 * Con origen "" es la vuelta de un inicio de sesión en el navegador (Google, ui.js): un GET /?…state=<nonce>… (sin Origin);
 *   lo que queda guardado es la consulta («?code=…&state=…») y el navegador ve «ya puedes volver al juego».
 * ponytail: un receptor a la vez y una conexión cada vez (es una persona en su ordenador, no un servidor). */
#if defined(_WIN32) || defined(__APPLE__) || defined(__linux__)
#ifdef _WIN32
#include <ws2tcpip.h>
typedef SOCKET sock_t;
#define SOCK_BAD INVALID_SOCKET
#define sock_close closesocket
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
typedef int sock_t;
#define SOCK_BAD (-1)
#define sock_close close
#endif
#include <ctype.h>
#include "platform.h"   // (plat_keep_alive)
#define INBOX_MAX (8 << 20)
static pthread_mutex_t inbox_mx = PTHREAD_MUTEX_INITIALIZER;
static char *inbox_body, inbox_path[80], inbox_origin[200];
static int inbox_running, inbox_port;
static time_t inbox_until;
static sock_t inbox_fd = SOCK_BAD;

// Espera hasta `secs` a que llegue algo y lo lee. <= 0: nada (cerrado, error o tiempo).
static int
inbox_recv(sock_t c, char *buf, int len, int secs) {
  fd_set r;
  struct timeval tv = { secs, 0 };
  FD_ZERO(&r); FD_SET(c, &r);
  if(select((int)c + 1, &r, NULL, NULL, &tv) <= 0) return -1;
  return (int)recv(c, buf, len, 0);
}
static void
inbox_reply(sock_t c, const char *status) {
  char h[700];
  int n = snprintf(h, sizeof h, "HTTP/1.1 %s\r\nAccess-Control-Allow-Origin: %s\r\nAccess-Control-Allow-Methods: POST\r\n"
    "Access-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n"
    "Content-Length: 0\r\nConnection: close\r\n\r\n", status, inbox_origin);
  send(c, h, n, 0);
}
// Una conexión: 1 si trajo la partida.
static int
inbox_serve(sock_t c) {
  char head[16384], low[16384], *end, *p, method[8] = "", path[4096] = "";
  int got = 0, n, ok = 0;
  long len = -1;
  while(got < (int)sizeof head - 1 && (n = inbox_recv(c, head + got, (int)sizeof head - 1 - got, 5)) > 0) {
    got += n; head[got] = 0;
    if(strstr(head, "\r\n\r\n")) break;
  }
  if(got <= 0 || !(end = strstr(head, "\r\n\r\n"))) return 0;
  for(int i = 0; i <= got; i++) low[i] = (char)tolower((unsigned char)head[i]);
  sscanf(head, "%7s %4095s", method, path);
  if(!inbox_origin[0]) {   // la vuelta del navegador (inicio de sesión): GET /?…&state=<nonce>
    char want[96];
    pthread_mutex_lock(&inbox_mx);
    snprintf(want, sizeof want, "state=%s", inbox_path + 1);
    pthread_mutex_unlock(&inbox_mx);
    const char *st = strcmp(method, "GET") || strncmp(path, "/?", 2) ? NULL : strstr(path, want);
    int good = st && (st[-1] == '?' || st[-1] == '&') && (st[strlen(want)] == 0 || st[strlen(want)] == '&');
    const char *page = good
      ? "<!doctype html><meta charset=utf-8><title>PokéSurvivor</title><body style=\"font:18px sans-serif;text-align:center;padding:3em\">"
        "<h2>&#10003; PokéSurvivor</h2><p>Ya puedes volver al juego. · You can go back to the game.</p>"
      : "<!doctype html><meta charset=utf-8><title>PokéSurvivor</title><p>?</p>";
    char h[300];
    int n = snprintf(h, sizeof h, "HTTP/1.1 %s\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: %d\r\n"
      "Cache-Control: no-store\r\nConnection: close\r\n\r\n", good ? "200 OK" : "404 Not Found", (int)strlen(page));
    send(c, h, n, 0); send(c, page, (int)strlen(page), 0);
    if(!good) return 0;
    char *q = strdup(path + 1);
    if(!q) return 0;
    pthread_mutex_lock(&inbox_mx);
    free(inbox_body); inbox_body = q;
    pthread_mutex_unlock(&inbox_mx);
    return 1;
  }
  // El origen tiene que ser el de la web (lo pone el navegador; otra página no puede fingirlo).
  p = strstr(low, "\r\norigin:");
  if(p) { p += 9; while(*p == ' ') p++; }
  int origin_ok = p && !strncmp(p, inbox_origin, strlen(inbox_origin)) && (p[strlen(inbox_origin)] == '\r');
  if(!strcmp(method, "OPTIONS")) { inbox_reply(c, origin_ok ? "204 No Content" : "403 Forbidden"); return 0; }
  if((p = strstr(low, "\r\ncontent-length:"))) len = strtol(p + 17, NULL, 10);
  pthread_mutex_lock(&inbox_mx);
  int path_ok = !strcmp(path, inbox_path);
  pthread_mutex_unlock(&inbox_mx);
  if(strcmp(method, "POST") || !path_ok || !origin_ok || len <= 0 || len > INBOX_MAX) {
    inbox_reply(c, "403 Forbidden"); return 0;
  }
  char *body = malloc((size_t)len + 1);
  int have = got - (int)(end + 4 - head);
  if(!body) { inbox_reply(c, "500 Internal Server Error"); return 0; }
  if(have > len) have = (int)len;
  memcpy(body, end + 4, (size_t)have);
  while(have < len && (n = inbox_recv(c, body + have, (int)(len - have), 10)) > 0) have += n;
  if(have == len) {
    body[len] = 0;
    pthread_mutex_lock(&inbox_mx);
    free(inbox_body); inbox_body = body; body = NULL;
    pthread_mutex_unlock(&inbox_mx);
    ok = 1;
  }
  free(body);
  inbox_reply(c, ok ? "200 OK" : "400 Bad Request");
  return ok;
}
static void *
inbox_thread(void *arg) {
  sock_t s = inbox_fd;
  (void)arg;
  while(time(NULL) < inbox_until) {
    fd_set r;
    struct timeval tv = { 1, 0 };
    FD_ZERO(&r); FD_SET(s, &r);
    if(select((int)s + 1, &r, NULL, NULL, &tv) <= 0) continue;
    sock_t c = accept(s, NULL, NULL);
    if(c == SOCK_BAD) continue;
    int done = inbox_serve(c);
    sock_close(c);
    if(done) break;
  }
  sock_close(s);
  pthread_mutex_lock(&inbox_mx);
  inbox_fd = SOCK_BAD; inbox_running = 0;
  pthread_mutex_unlock(&inbox_mx);
  plat_keep_alive(0);
  return NULL;
}
static JSValue
n_inbox(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *nonce = JS_ToCString(ctx, argv[0]), *origin = argc > 1 ? JS_ToCString(ctx, argv[1]) : NULL;
  struct sockaddr_in a;
  socklen_t al = sizeof a;
  pthread_t t;
  int port = 0, okn = nonce && strlen(nonce) >= 16 && strlen(nonce) < 64 && origin && (!*origin || !strncmp(origin, "https://", 8))
    && strlen(origin) < sizeof inbox_origin;
  for(const char *q = nonce; okn && *q; q++) if(!isalnum((unsigned char)*q)) okn = 0;
  pthread_mutex_lock(&inbox_mx);
  if(okn && inbox_running) {   // (ya escuchaba: el mismo puerto, con el código nuevo y diez minutos más)
    snprintf(inbox_path, sizeof inbox_path, "/%s", nonce);
    snprintf(inbox_origin, sizeof inbox_origin, "%s", origin);
    for(char *q = inbox_origin; *q; q++) *q = (char)tolower((unsigned char)*q);
    inbox_until = time(NULL) + 600;
    port = inbox_port;
    okn = 0;
  }
  pthread_mutex_unlock(&inbox_mx);
  if(okn) {
    sock_t s = socket(AF_INET, SOCK_STREAM, 0);
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET; a.sin_addr.s_addr = htonl(INADDR_LOOPBACK); a.sin_port = 0;   // (puerto libre)
    if(s != SOCK_BAD && !bind(s, (struct sockaddr *)&a, sizeof a) && !listen(s, 4) && !getsockname(s, (struct sockaddr *)&a, &al)) {
      snprintf(inbox_path, sizeof inbox_path, "/%s", nonce);
      snprintf(inbox_origin, sizeof inbox_origin, "%s", origin);
      for(char *q = inbox_origin; *q; q++) *q = (char)tolower((unsigned char)*q);
      inbox_fd = s; inbox_until = time(NULL) + 600; inbox_running = 1; inbox_port = ntohs(a.sin_port);
      if(pthread_create(&t, NULL, inbox_thread, NULL)) { inbox_running = 0; inbox_fd = SOCK_BAD; sock_close(s); }
      else { pthread_detach(t); port = inbox_port; plat_keep_alive(1); }
    } else if(s != SOCK_BAD) sock_close(s);
  }
  JS_FreeCString(ctx, nonce);
  if(origin) JS_FreeCString(ctx, origin);
  return JS_NewInt32(ctx, port);
}
static JSValue
n_inbox_take(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  char *b;
  pthread_mutex_lock(&inbox_mx);
  b = inbox_body; inbox_body = NULL;
  pthread_mutex_unlock(&inbox_mx);
  if(!b) return JS_NULL;
  JSValue v = JS_NewString(ctx, b);
  free(b);
  return v;
}
#endif

static JSValue
n_ws_send(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int id = num(ctx, argv[0]), bin = JS_GetArrayBuffer(ctx, &(size_t){ 0 }, argv[1]) != NULL;
  out_t *o = calloc(1, sizeof *o);
  ws_t *w;
  if(!bin) JS_FreeValue(ctx, JS_GetException(ctx));
  if(!o) return JS_FALSE;
  o->data = str(ctx, argv[1], &o->len);
  o->bin = bin;
  pthread_mutex_lock(&ws_mx);
  if((w = ws_find_locked(id))) {
    pthread_mutex_lock(&w->mx);
    if(w->out_tail) w->out_tail->next = o; else w->out = o;
    w->out_tail = o;
    pthread_mutex_unlock(&w->mx);
  }
  pthread_mutex_unlock(&ws_mx);
  if(!w) { free(o->data); free(o); return JS_FALSE; }
  return JS_TRUE;
}

static JSValue
n_ws_close(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int id = num(ctx, argv[0]), code = argc > 1 && !JS_IsUndefined(argv[1]) ? num(ctx, argv[1]) : 1000;
  ws_t *w;
  pthread_mutex_lock(&ws_mx);
  if((w = ws_find_locked(id))) {
    pthread_mutex_lock(&w->mx);
    w->closing = 1; w->close_code = code;
    pthread_mutex_unlock(&w->mx);
  }
  pthread_mutex_unlock(&ws_mx);
  return JS_UNDEFINED;
}


static JSValue
n_debug(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  char b[220];
#ifdef PS5_TITLE
  snprintf(b, sizeof b, "hilo de red: %lu vueltas, ahora en «%s» · WebSocket: %s hace %.0f s", (unsigned long)http_loops, http_phase,
           ws_phase, mono_s() - ws_since);
#else
  snprintf(b, sizeof b, "hilo de red: %lu vueltas, ahora en «%s»", (unsigned long)http_loops, http_phase);
#endif
  return JS_NewString(ctx, b);
}

static JSValue
n_poll(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  ev_t *e;
  JSValue list = JS_NewArray(ctx);
  uint32_t i = 0;
  pthread_mutex_lock(&ev_mx);
  e = ev_head; ev_head = ev_tail = NULL;
  pthread_mutex_unlock(&ev_mx);
  while(e) {
    ev_t *n = e->next;
    JSValue it = JS_NewArray(ctx);
    uint32_t k = 0;
    JS_SetPropertyUint32(ctx, it, k++, JS_NewString(ctx, EV_NAME[e->kind]));
    JS_SetPropertyUint32(ctx, it, k++, JS_NewInt32(ctx, e->id));
    switch(e->kind) {
    case EV_HEAD:
      JS_SetPropertyUint32(ctx, it, k++, JS_NewInt32(ctx, e->status));
      JS_SetPropertyUint32(ctx, it, k++, JS_NewStringLen(ctx, e->a ? e->a : "", e->len));
      JS_SetPropertyUint32(ctx, it, k++, JS_NewString(ctx, e->b ? e->b : ""));
      break;
    case EV_DATA: case EV_ERR:
      JS_SetPropertyUint32(ctx, it, k++, JS_NewStringLen(ctx, e->a ? e->a : "", e->len));
      break;
    case EV_WS_OPEN:
      JS_SetPropertyUint32(ctx, it, k++, JS_NewString(ctx, e->b ? e->b : ""));
      break;
    case EV_WS_MSG:
      JS_SetPropertyUint32(ctx, it, k++, e->bin ? JS_NewArrayBufferCopy(ctx, (uint8_t*)e->a, e->len)
                                                 : JS_NewStringLen(ctx, e->a ? e->a : "", e->len));
      break;
    case EV_WS_CLOSE:
      JS_SetPropertyUint32(ctx, it, k++, JS_NewInt32(ctx, e->status));
      JS_SetPropertyUint32(ctx, it, k++, JS_NewString(ctx, e->b ? e->b : ""));
      break;
    }
    JS_SetPropertyUint32(ctx, list, i++, it);
    free(e->a); free(e->b); free(e);
    e = n;
  }
  return list;
}

// Al recargar el JS: lo que estuviera en marcha deja de contar (sus eventos se tiran) y los sockets se cierran.
void
net_reset(void) {
  pthread_mutex_lock(&rq_mx);
  while(pending) { req_t *r = pending; pending = r->next; req_free(r); }
  n_aborts = 0;
  net_gen++;
  pthread_mutex_unlock(&rq_mx);
  pthread_mutex_lock(&ws_mx);
  for(ws_t *w = sockets; w; w = w->next) { pthread_mutex_lock(&w->mx); w->closing = 1; w->close_code = 1001; pthread_mutex_unlock(&w->mx); }
  pthread_mutex_unlock(&ws_mx);
  pthread_mutex_lock(&ev_mx);
  while(ev_head) { ev_t *e = ev_head; ev_head = e->next; free(e->a); free(e->b); free(e); }
  ev_tail = NULL;
  pthread_mutex_unlock(&ev_mx);
  if(multi) curl_multi_wakeup(multi);
}

int
net_init(JSContext *ctx, JSValue ps, const char *root, void (*log)(const char *fmt, ...)) {
  pthread_t t;
  FILE *f;
  static int started;
  say = log;
#ifdef PS5_TITLE
  { extern void (*compat_say)(const char *fmt, ...); compat_say = log; }   // (title/compat.c: su log, al búfer)
#endif
  if(started) goto reg;   // al recargar el JS sólo hay que volver a poner las funciones
  started = 1;
#ifdef PS5_TITLE
  {   // en un título, la red de la consola se inicia antes del primer socket (el payload ya la tiene)
    int sceNetInit(void);
    void title_wait_test(void);   // (title/compat.c)
    int rc = sceNetInit();
    say("[red] sceNetInit %d\n", rc);
    title_wait_test();


  }
#endif
  if(curl_global_init(CURL_GLOBAL_DEFAULT)) return -1;
  snprintf(cainfo, sizeof cainfo, "%s/cacert.pem", root);
  if(!(f = fopen(cainfo, "rb"))) { say("[red] sin %s: no se podrá comprobar ningún certificado\n", cainfo); cainfo[0] = 0; }
  else fclose(f);
  if(!(multi = curl_multi_init())) return -1;
  if(pthread_create(&t, NULL, http_thread, NULL)) return -1;
  pthread_detach(t);
  say("[red] %s\n", curl_version());
reg:
#define NFN(name, fn, n) JS_SetPropertyStr(ctx, ps, name, JS_NewCFunction(ctx, fn, name, n))
  NFN("net_request", n_request, 6);
  NFN("net_abort", n_abort, 1);
  NFN("net_ws_open", n_ws_open, 4);
  NFN("net_ws_send", n_ws_send, 2);
  NFN("net_ws_close", n_ws_close, 2);
  NFN("net_poll", n_poll, 0);
  NFN("net_debug", n_debug, 0);
#if defined(_WIN32) || defined(__APPLE__) || defined(__linux__)
  NFN("net_inbox", n_inbox, 2);
  NFN("net_inbox_take", n_inbox_take, 0);
#endif
  return 0;
}
