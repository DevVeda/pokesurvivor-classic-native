/* compat.c — lo que piden OpenSSL y curl (de PacBrew, compilados para payloads) y que ni la libc de un título
 * ni libps5platform traen. El resto de huecos de la libc van a las ps5_* de libps5platform con --defsym
 * (native/title/build-title.sh, la lista de tools/radv-link.sh de PS5_Vulkan).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

// Log al búfer de main.c (lo pone net_init). Nunca fprintf(stderr) desde el hilo de red: escribe en /data
// y, si el disco se atasca, el hilo se queda parado ahí (y con él toda la red).
void (*compat_say)(const char *fmt, ...);
#define LOGF(...) (compat_say ? compat_say(__VA_ARGS__) : (void)fprintf(stderr, __VA_ARGS__))

// OpenSSL (BIO de datagramas, para el DTLS del cooperativo): de uno en uno con sendmsg/recvmsg.
ssize_t
sendmmsg(int fd, struct mmsghdr *v, size_t n, int flags) {
  size_t i = 0;
  for(; i < n; i++) {
    ssize_t r = sendmsg(fd, &v[i].msg_hdr, flags);
    if(r < 0) return i ? (ssize_t)i : -1;
    v[i].msg_len = (unsigned int)r;
  }
  return (ssize_t)i;
}
ssize_t
recvmmsg(int fd, struct mmsghdr *v, size_t n, int flags, const struct timespec *timeout) {
  (void)timeout;
  size_t i = 0;
  for(; i < n; i++) {
    ssize_t r = recvmsg(fd, &v[i].msg_hdr, i ? flags | MSG_DONTWAIT : flags);
    if(r < 0) return i ? (ssize_t)i : -1;
    v[i].msg_len = (unsigned int)r;
  }
  return (ssize_t)i;
}

// curl (socketpair de reserva): pipe con sus banderas.
int
pipe2(int fd[2], int flags) {
  if(pipe(fd)) return -1;
  for(int i = 0; i < 2; i++) {
    if(flags & O_NONBLOCK) fcntl(fd[i], F_SETFL, fcntl(fd[i], F_GETFL) | O_NONBLOCK);
    if(flags & O_CLOEXEC) fcntl(fd[i], F_SETFD, FD_CLOEXEC);
  }
  return 0;
}

// curl (zona de una IPv6 con %interfaz): no hay nombres de interfaz.
unsigned int if_nametoindex(const char *name) { (void)name; return 0; }

// OpenSSL ASYNC (las "fibras"): no se usa. ponytail: si algún día se usa, que se vea en el log.
int _setjmp(void *env) { (void)env; return 0; }
void
_longjmp(void *env, int v) {
  (void)env; (void)v;
  fprintf(stderr, "*** _longjmp: OpenSSL ASYNC no está en el título\n");
  abort();
}

// plog (el registro de libdatachannel) pide el número del hilo con syscall(SYS_thr_self, &tid): un título no hace
// llamadas directas al sistema. Sólo ésa, con pthread_self; las demás, ENOSYS.
#include <pthread.h>
#include <stdarg.h>
#include <stdint.h>
int
syscall(int number, ...) {
  if(number == 432) {   // SYS_thr_self
    va_list ap;
    va_start(ap, number);
    long *tid = va_arg(ap, long*);
    va_end(ap);
    if(tid) *tid = (long)(uintptr_t)pthread_self();
    return 0;
  }
  errno = ENOSYS;
  return -1;
}

// zstd (lo usa curl) declara débiles sus ganchos de trazas; el conversor del título no admite símbolos sin dueño.
// Devolver 0 es "sin trazas".
unsigned long long ZSTD_trace_compress_begin(const void *cctx) { (void)cctx; return 0; }
void ZSTD_trace_compress_end(unsigned long long ctx, const void *trace) { (void)ctx; (void)trace; }
unsigned long long ZSTD_trace_decompress_begin(const void *dctx) { (void)dctx; return 0; }
void ZSTD_trace_decompress_end(unsigned long long ctx, const void *trace) { (void)ctx; (void)trace; }

// Lo que en los payloads sale de libScePosixForWebKit (que un título no carga: sus funciones serían NULL y llamarlas,
// un salto a 0). getaddrinfo, opendir y arc4random van a las ps5_* (build-title.sh); éstas no las tiene la plataforma.
// Con prefijo title_ y --defsym (build-title.sh): con su nombre, el título las exportaría, y el conversor no lo admite.
#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <string.h>
const char *title_gai_strerror(int e) { (void)e; return "error de getaddrinfo"; }
int title_isatty(int fd) { (void)fd; errno = ENOTTY; return 0; }
int mkstemps(char *tmpl, int suffixlen);
int title_mkstemp(char *tmpl) { return mkstemps(tmpl, 0); }   // (RADV: el volcado de ensamblador de ACO; el SDK no la tiene)
struct hostent *title_gethostbyname(const char *name) { (void)name; return NULL; }   // (sin h_errno: tampoco lo hay)
int title_fnmatch(const char *pattern, const char *string, int flags) { (void)flags; return strcmp(pattern, string) ? 1 : 0; }   // ponytail: sólo igualdad
// Sólo numérico (lo que piden libjuice y curl para escribir direcciones): IP con inet_ntop y puerto en decimal.
int
title_getnameinfo(const struct sockaddr *sa, socklen_t salen, char *host, size_t hostlen, char *serv, size_t servlen, int flags) {
  (void)salen; (void)flags;
  const void *addr; unsigned port;
  if(sa->sa_family == AF_INET) { addr = &((const struct sockaddr_in*)sa)->sin_addr; port = ntohs(((const struct sockaddr_in*)sa)->sin_port); }
  else if(sa->sa_family == AF_INET6) { addr = &((const struct sockaddr_in6*)sa)->sin6_addr; port = ntohs(((const struct sockaddr_in6*)sa)->sin6_port); }
  else return EAI_FAMILY;
  if(host && hostlen && !inet_ntop(sa->sa_family, addr, host, hostlen)) return EAI_OVERFLOW;
  if(serv && servlen && snprintf(serv, servlen, "%u", port) >= (int)servlen) return EAI_OVERFLOW;
  return 0;
}

// getaddrinfo: el de libps5platform rechaza a propósito los nombres (en un título no hay DNS de la libc), y el de los
// payloads sale de libScePosixForWebKit. Aquí, con el resolvedor de la consola (libSceNet): una IP numérica se
// convierte sin más; un nombre se pregunta al DNS de la consola. Sólo IPv4 (la red y el cooperativo no piden más).
// Cada respuesta es un solo bloque (addrinfo + sockaddr_in): title_freeaddrinfo los suelta con free.
#include <pthread.h>
int sceNetPoolCreate(const char *name, int size, int flags);
int sceNetResolverCreate(const char *name, int memid, int flags);
int sceNetResolverStartNtoa(int rid, const char *hostname, struct in_addr *addr, int timeout, int retry, int flags);
int sceNetResolverDestroy(int rid);

static int net_pool = -1;
static void make_pool(void) { net_pool = sceNetPoolCreate("pokesurvivor", 64 * 1024, 0); }

// El DNS preguntado a mano (UDP, como la libc de un payload): sceNetResolver tardaba a veces más de 12 s con un nombre
// (el servidor regional de la base de datos de las salas, 30-10-2026), y el WebSocket esperaba todo ese rato.
// Una pregunta A a 8.8.8.8 / 1.1.1.1, 700 ms por intento y 4 intentos alternando. ponytail: sólo IPv4 y la primera
// respuesta A (lo que piden curl y libjuice aquí); sin EDNS ni TCP (respuestas de más de 512 B: no hacen falta).
#include <sys/select.h>
ssize_t __real_sendto(int, const void*, size_t, int, const struct sockaddr*, socklen_t);
ssize_t __real_recvfrom(int, void*, size_t, int, struct sockaddr*, socklen_t*);
static int
dns_udp(const char *node, struct in_addr *out) {
  unsigned char q[300], r[512];
  size_t n = 12, len = strlen(node);
  if(len == 0 || len > 250) return -1;
  unsigned id = (unsigned)time(NULL) ^ (unsigned)(uintptr_t)node;
  memset(q, 0, 12);
  q[0] = id >> 8; q[1] = id; q[2] = 1; q[5] = 1;   // id, «recursión, por favor», una pregunta
  for(const char *p = node; *p; ) {   // el nombre en etiquetas: 3www7example3com0
    size_t l = strcspn(p, ".");
    if(!l || l > 63) return -1;
    q[n++] = l; memcpy(q + n, p, l); n += l; p += l;
    if(*p == '.') p++;
  }
  q[n++] = 0; q[n++] = 0; q[n++] = 1; q[n++] = 0; q[n++] = 1;   // tipo A, clase IN
  int fd = socket(AF_INET, SOCK_DGRAM, 0);
  if(fd < 0 || fd >= FD_SETSIZE) { LOGF("[red] dns %s por UDP: socket %d (errno %d)\n", node, fd, errno); if(fd >= 0) close(fd); return -1; }
  static const char *SERVERS[] = { "8.8.8.8", "1.1.1.1" };
  int ok = -1;
  char why[200] = "";   // ponytail: diagnóstico: qué pasó en cada intento fallido
  for(int t = 0; t < 4 && ok; t++) {
    struct sockaddr_in sa = { 0 };
    sa.sin_family = AF_INET; sa.sin_port = htons(53);
    inet_pton(AF_INET, SERVERS[t % 2], &sa.sin_addr);
    size_t wl = strlen(why);
    if(__real_sendto(fd, q, n, 0, (struct sockaddr*)&sa, sizeof sa) < 0) { snprintf(why + wl, sizeof why - wl, " sendto:%d", errno); continue; }
    fd_set s; struct timeval tv = { 0, 700000 };
    FD_ZERO(&s); FD_SET(fd, &s);
    if(select(fd + 1, &s, NULL, NULL, &tv) <= 0) { snprintf(why + wl, sizeof why - wl, " sin-respuesta"); continue; }
    ssize_t got = __real_recvfrom(fd, r, sizeof r, MSG_DONTWAIT, NULL, NULL);   // (si select mintiera, que no se quede esperando)
    if(got < 12 || r[0] != q[0] || r[1] != q[1] || (r[3] & 15)) { snprintf(why + wl, sizeof why - wl, " mala(%zd,rc%d)", got, got >= 4 ? r[3] & 15 : -1); continue; }   // otra respuesta, o error (NXDOMAIN…)
    size_t i = n;                                                         // tras la pregunta (la misma que se mandó)
    for(int an = r[6] << 8 | r[7]; an-- > 0 && i + 12 <= (size_t)got; ) {
      if((r[i] & 0xc0) == 0xc0) i += 2; else { while(i < (size_t)got && r[i]) i += r[i] + 1; i++; }   // el nombre
      if(i + 10 > (size_t)got) break;
      unsigned type = r[i] << 8 | r[i + 1], rdlen = r[i + 8] << 8 | r[i + 9];
      i += 10;
      if(type == 1 && rdlen == 4 && i + 4 <= (size_t)got) { memcpy(out, r + i, 4); ok = 0; break; }
      i += rdlen;   // (los CNAME se saltan: la A del final llega en la misma respuesta)
    }
    if(ok) { size_t wl = strlen(why); snprintf(why + wl, sizeof why - wl, " sin-A"); }
  }
  close(fd);
  if(ok) LOGF("[red] dns %s por UDP falló:%s\n", node, why);
  return ok;
}

static int
resolve(const char *node, struct in_addr *out) {
  // Lo ya resuelto (5 min), para todos los hilos: el de red y el del WebSocket pedían el mismo nombre a la vez.
  static struct { char name[128]; struct in_addr a; time_t at; } cache[16];
  static pthread_mutex_t mx = PTHREAD_MUTEX_INITIALIZER;
  time_t now = time(NULL);
  pthread_mutex_lock(&mx);
  for(int i = 0; i < 16; i++) if(!strcmp(cache[i].name, node) && now - cache[i].at < 300) { *out = cache[i].a; pthread_mutex_unlock(&mx); return 0; }
  pthread_mutex_unlock(&mx);

  struct timespec t0, t1;
  clock_gettime(CLOCK_MONOTONIC, &t0);
  int local = !strcmp(node, "localhost");
  int rc = local ? -1 : dns_udp(node, out);
  const char *how = "udp";
  if(local) { out->s_addr = htonl(INADDR_LOOPBACK); rc = 0; how = "local"; }
  if(rc) {   // sin respuesta del DNS público (red que lo bloquea…): el de la consola
    LOGF("[red] dns %s: se pregunta al de la consola\n", node);   // (si se queda aquí, el log lo dice)
    static pthread_once_t once = PTHREAD_ONCE_INIT;
    pthread_once(&once, make_pool);
    int rid = net_pool < 0 ? -1 : sceNetResolverCreate("pokesurvivor", net_pool, 0);
    rc = rid < 0 ? -1 : sceNetResolverStartNtoa(rid, node, out, 0, 0, 0) < 0 ? -1 : 0;   // (bloquea: lo llaman los hilos de red)
    if(rid >= 0) sceNetResolverDestroy(rid);
    how = "consola";
  }
  clock_gettime(CLOCK_MONOTONIC, &t1);
  char ip[16] = "?";
  inet_ntop(AF_INET, out, ip, sizeof ip);
  LOGF("[red] dns %s -> %s (%s, %ld ms)\n", node, rc ? "fallo" : ip, how,
          (long)((t1.tv_sec - t0.tv_sec) * 1000 + (t1.tv_nsec - t0.tv_nsec) / 1000000));
  if(rc) return -1;
  pthread_mutex_lock(&mx);
  int slot = 0;
  for(int i = 1; i < 16; i++) if(cache[i].at < cache[slot].at) slot = i;
  snprintf(cache[slot].name, sizeof cache[slot].name, "%s", node);
  cache[slot].a = *out; cache[slot].at = now;
  pthread_mutex_unlock(&mx);
  return 0;
}

int
title_getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res) {
  struct in_addr a;
  int flags = hints ? hints->ai_flags : 0, family = hints ? hints->ai_family : AF_UNSPEC;
  if(!res || (!node && !service)) return EAI_NONAME;
  if(family != AF_UNSPEC && family != AF_INET) return EAI_FAMILY;
  if(!node) a.s_addr = htonl((flags & AI_PASSIVE) ? INADDR_ANY : INADDR_LOOPBACK);
  else if(inet_pton(AF_INET, node, &a) != 1) {
    if((flags & AI_NUMERICHOST) || resolve(node, &a)) return EAI_NONAME;
  }
  long port = 0;
  if(service && *service) {
    char *end;
    port = strtol(service, &end, 10);
    if(*end) port = !strcmp(service, "https") ? 443 : !strcmp(service, "http") ? 80 : -1;
    if(port < 0 || port > 65535) return EAI_SERVICE;
  }
  struct { struct addrinfo ai; struct sockaddr_in sin; } *b = calloc(1, sizeof *b);
  if(!b) return EAI_MEMORY;
  b->sin.sin_len = sizeof b->sin;
  b->sin.sin_family = AF_INET;
  b->sin.sin_port = htons((unsigned short)port);
  b->sin.sin_addr = a;
  b->ai.ai_flags = flags;
  b->ai.ai_family = AF_INET;
  b->ai.ai_socktype = hints ? hints->ai_socktype : 0;
  b->ai.ai_protocol = hints ? hints->ai_protocol : 0;
  b->ai.ai_addrlen = sizeof b->sin;
  b->ai.ai_addr = (struct sockaddr*)&b->sin;
  *res = &b->ai;
  return 0;
}
void
title_freeaddrinfo(struct addrinfo *ai) {
  while(ai) { struct addrinfo *next = ai->ai_next; free(ai); ai = next; }
}

// Sockets no bloqueantes: en un título, fcntl(O_NONBLOCK) no basta; la consola lo pide con setsockopt(SOL_SOCKET,
// SO_NBIO = 0x1200) (native/TITLE.md). curl y libjuice usan fcntl: --wrap=fcntl (build-title.sh) hace los dos.
// fcntl(O_NONBLOCK) devuelve 0 en un título, pero los sockets siguen bloqueando: el hilo de red se quedaba
// leyendo la conexión larga de Firestore (datos cada 30 s) y no atendía nada más ("sin conexión", Amigos colgado; al
// arrancar, ~1 s por paso). Se apunta qué sockets se pidieron no bloqueantes, y sus recv/send llevan MSG_DONTWAIT
// (--wrap de build-title.sh): curl, OpenSSL (lee por curl), el WebSocket y libjuice (el cooperativo).
#define NB_MAX 4096
static unsigned char nonblock[NB_MAX];
// Tampoco basta MSG_DONTWAIT (curl seguía parado dentro de recv: su pila, 29-10-2026). Lo que sí funciona es select:
// en un socket no bloqueante, antes de leer o escribir se pregunta con plazo 0; si no está listo, EAGAIN al momento.
// recv/send/recvfrom/sendto: SIEMPRE así (sólo los usan sockets, y en el título todos los quieren no bloqueantes: curl,
// el WebSocket, libjuice). Apuntar los no bloqueantes no bastaba: los de curl seguían sin marcar y su recv paraba.
// read/write sí miran la marca (también leen archivos).
static int
sock_not_ready(int fd, int write) {
  if(fd < 0 || fd >= FD_SETSIZE) return 0;
  fd_set s; struct timeval zero = { 0, 0 };
  FD_ZERO(&s); FD_SET(fd, &s);
  if(select(fd + 1, write ? NULL : &s, write ? &s : NULL, NULL, &zero) == 0) { errno = EAGAIN; return 1; }
  return 0;
}
static int not_ready(int fd, int write) { return fd >= 0 && fd < NB_MAX && nonblock[fd] && sock_not_ready(fd, write); }
ssize_t __real_recv(int, void*, size_t, int);
ssize_t __real_send(int, const void*, size_t, int);
ssize_t __real_recvfrom(int, void*, size_t, int, struct sockaddr*, socklen_t*);
ssize_t __real_sendto(int, const void*, size_t, int, const struct sockaddr*, socklen_t);
ssize_t __wrap_recv(int fd, void *b, size_t n, int f) { return sock_not_ready(fd, 0) ? -1 : __real_recv(fd, b, n, f | MSG_DONTWAIT); }
ssize_t __wrap_send(int fd, const void *b, size_t n, int f) { return sock_not_ready(fd, 1) ? -1 : __real_send(fd, b, n, f | MSG_DONTWAIT); }
ssize_t __wrap_recvfrom(int fd, void *b, size_t n, int f, struct sockaddr *a, socklen_t *l) { return sock_not_ready(fd, 0) ? -1 : __real_recvfrom(fd, b, n, f | MSG_DONTWAIT, a, l); }
ssize_t __wrap_sendto(int fd, const void *b, size_t n, int f, const struct sockaddr *a, socklen_t l) { return sock_not_ready(fd, 1) ? -1 : __real_sendto(fd, b, n, f | MSG_DONTWAIT, a, l); }
// Y read/write en esos sockets (por si alguien, como el BIO de sockets de OpenSSL, los usa): recv/send sin esperar.
ssize_t __real_read(int, void*, size_t);
ssize_t __real_write(int, const void*, size_t);
// Lo que no es un socket (el pipe con el que libjuice despierta a su hilo, también no bloqueante) da ENOTSOCK con
// recv/send: entonces read/write de siempre. Sin esto, libjuice no se despertaba («Failed to interrupt poll by writing
// to pipe, errno=38») y el cooperativo iba a tirones (18-11-2026).
ssize_t __wrap_read(int fd, void *b, size_t n) {
  if(!(fd >= 0 && fd < NB_MAX && nonblock[fd])) return __real_read(fd, b, n);
  if(not_ready(fd, 0)) return -1;
  ssize_t r = __real_recv(fd, b, n, MSG_DONTWAIT);
  return r < 0 && errno == ENOTSOCK ? __real_read(fd, b, n) : r;
}
ssize_t __wrap_write(int fd, const void *b, size_t n) {
  if(!(fd >= 0 && fd < NB_MAX && nonblock[fd])) return __real_write(fd, b, n);
  if(not_ready(fd, 1)) return -1;
  ssize_t r = __real_send(fd, b, n, MSG_DONTWAIT);
  return r < 0 && errno == ENOTSOCK ? __real_write(fd, b, n) : r;
}
int __real_fcntl(int fd, int cmd, ...);
int sceNetSetsockopt(int s, int level, int optname, const void *optval, unsigned optlen);
int sceNetGetsockopt(int s, int level, int optname, void *optval, unsigned *optlen);
int
__wrap_fcntl(int fd, int cmd, ...) {
  va_list ap;
  va_start(ap, cmd);
  long arg = va_arg(ap, long);
  va_end(ap);
  int r = __real_fcntl(fd, cmd, arg);
  // curl (curlx_nonblock) sólo llama a F_SETFL si F_GETFL no dice ya O_NONBLOCK; en un título un socket nuevo ya lo
  // dice (y aun así bloquea): sin esto, los de curl nunca se apuntaban y su recv se quedaba parado (29-10-2026).
  if(cmd == F_GETFL && r >= 0 && (r & O_NONBLOCK) && fd >= 0 && fd < NB_MAX) nonblock[fd] = 1;
  // FD_CLOEXEC: en un título falla en los sockets (EINVAL) y curl dejaba de conectar ("fcntl set CLOEXEC: Invalid
  // argument"). Un título no lanza otros programas: no hace falta. F_GETFL que falla: sin banderas.
  if(r < 0 && (cmd == F_SETFD || cmd == F_GETFD || cmd == F_GETFL)) return 0;
  if(cmd == F_SETFL) {
    int on = (arg & O_NONBLOCK) != 0, e0 = errno;
    int s1 = setsockopt(fd, SOL_SOCKET, 0x1200, &on, sizeof on), e1 = errno;
    int s2 = s1 == 0 ? 0 : sceNetSetsockopt(fd, 0xffff, 0x1200, &on, sizeof on);   // SCE_NET_SOL_SOCKET, SO_NBIO
    // ¿De verdad no bloquea? Leer de un socket sin datos debe dar EAGAIN al momento.
    static int shown;
    if(on && shown < 6) {
      shown++;
      int nb = -1;
      unsigned len = sizeof nb;
      sceNetGetsockopt(fd, 0xffff, 0x1200, &nb, &len);
      LOGF("[red] fd %d no bloqueante: fcntl %d (errno %d) · setsockopt %d (errno %d) · sceNetSetsockopt %d · SO_NBIO=%d\n",
              fd, r, e0, s1, e1, s2, nb);
    }
    if(s1 == 0 || s2 == 0) r = 0;   // (en lo que no es un socket, fallan y no pasa nada)
    if(fd >= 0 && fd < NB_MAX) nonblock[fd] = on;
  }
  return r;
}

// poll: en un título no despierta cuando llegan datos ni a su plazo (cada paso de una petición tardaba ~1 s, con el
// hilo casi sin CPU), y select sí (el WebSocket de Firebase va con select). --wrap=poll (build-title.sh): poll hecho
// con select, para curl, OpenSSL y libjuice (el cooperativo). Si algún descriptor no cabe en un fd_set, el de siempre.
// ioctl(FIONBIO): en un título está prohibido (EACCES) y libjuice lo usa para su socket UDP del cooperativo («Setting
// non-blocking mode on UDP socket failed, errno=13»: sin socket, sin direcciones propias, y la web decía «can't connect»,
// 02-11-2026). Como en fcntl: SO_NBIO de la consola si deja, y se apunta como no bloqueante (select + MSG_DONTWAIT).
#include <sys/filio.h>
int __real_ioctl(int fd, unsigned long req, ...);
int
__wrap_ioctl(int fd, unsigned long req, ...) {
  va_list ap;
  va_start(ap, req);
  void *arg = va_arg(ap, void*);
  va_end(ap);
  if(req != FIONBIO || !arg) return __real_ioctl(fd, req, arg);
  int on = *(int*)arg != 0;
  if(__real_ioctl(fd, req, arg) < 0) sceNetSetsockopt(fd, 0xffff, 0x1200, &on, sizeof on);   // SCE_NET_SOL_SOCKET, SO_NBIO
  if(fd >= 0 && fd < NB_MAX) nonblock[fd] = on;
  return 0;
}

#include <poll.h>
#include <sys/select.h>
int __real_poll(struct pollfd *fds, nfds_t n, int timeout);
int sceKernelUsleep(unsigned us);
// Mira una vez, sin esperar (select con plazo 0): cuántos están listos, y rellena revents.
static int
poll_now(struct pollfd *fds, nfds_t n) {
  fd_set r, w;
  int max = -1;
  FD_ZERO(&r); FD_ZERO(&w);
  for(nfds_t i = 0; i < n; i++) {
    int fd = fds[i].fd;
    fds[i].revents = 0;
    if(fd < 0) continue;
    if(fds[i].events & (POLLIN | POLLPRI | POLLRDNORM)) FD_SET(fd, &r);
    if(fds[i].events & (POLLOUT | POLLWRNORM)) FD_SET(fd, &w);
    if(fd > max) max = fd;
  }
  struct timeval zero = { 0, 0 };
  int rc = max < 0 ? 0 : select(max + 1, &r, &w, NULL, &zero);
  if(rc < 0 && errno == EBADF) {
    // Un descriptor ya cerrado: poll lo marca POLLNVAL y sigue; select falla entero. libjuice tomaba el fallo por fatal
    // («poll failed, errno=9») y su hilo terminaba: se caían todas las conexiones del cooperativo (18-11-2026).
    int bad = 0;
    for(nfds_t i = 0; i < n; i++) {
      int fd = fds[i].fd;
      if(fd < 0) continue;
      fd_set one; FD_ZERO(&one); FD_SET(fd, &one);
      if(select(fd + 1, &one, NULL, NULL, &zero) < 0 && errno == EBADF) { fds[i].revents = POLLNVAL; bad++; }
    }
    if(bad) return bad;
    errno = EBADF;
  }
  if(rc <= 0) return rc;
  int count = 0;
  for(nfds_t i = 0; i < n; i++) {
    int fd = fds[i].fd;
    if(fd < 0) continue;
    if(FD_ISSET(fd, &r)) fds[i].revents |= fds[i].events & (POLLIN | POLLPRI | POLLRDNORM);
    if(FD_ISSET(fd, &w)) fds[i].revents |= fds[i].events & (POLLOUT | POLLWRNORM);
    if(fds[i].revents) count++;
  }
  return count;
}
// Sin esperas del sistema (que en un título no vuelven al haber datos y redondean el plazo hacia arriba): mirar, y si
// no hay nada, dormir 1 ms y volver a mirar, hasta el plazo. ponytail: 1 ms de latencia y un despertar por ms mientras
// se espera; si un día poll funciona, quitar el --wrap.
int
__wrap_poll(struct pollfd *fds, nfds_t n, int timeout) {
  for(nfds_t i = 0; i < n; i++) if(fds[i].fd >= FD_SETSIZE) return __real_poll(fds, n, timeout);
  struct timespec t0, t;
  clock_gettime(CLOCK_MONOTONIC, &t0);
  for(;;) {
    int rc = poll_now(fds, n);
    if(rc != 0) return rc;
    clock_gettime(CLOCK_MONOTONIC, &t);
    long ms = (t.tv_sec - t0.tv_sec) * 1000 + (t.tv_nsec - t0.tv_nsec) / 1000000;
    if(timeout >= 0 && ms >= timeout) return 0;
    sceKernelUsleep(1000);
  }
}

// Al arrancar (main.c): cuánto duran de verdad las esperas de 10 ms del título.
void
title_wait_test(void) {
  struct timespec a, b;
  double ms[3];
  struct timeval tv = { 0, 10000 };
  clock_gettime(CLOCK_MONOTONIC, &a); __real_poll(NULL, 0, 10); clock_gettime(CLOCK_MONOTONIC, &b);
  ms[0] = (b.tv_sec - a.tv_sec) * 1e3 + (b.tv_nsec - a.tv_nsec) / 1e6;
  clock_gettime(CLOCK_MONOTONIC, &a); select(0, NULL, NULL, NULL, &tv); clock_gettime(CLOCK_MONOTONIC, &b);
  ms[1] = (b.tv_sec - a.tv_sec) * 1e3 + (b.tv_nsec - a.tv_nsec) / 1e6;
  clock_gettime(CLOCK_MONOTONIC, &a); sceKernelUsleep(10000); clock_gettime(CLOCK_MONOTONIC, &b);
  ms[2] = (b.tv_sec - a.tv_sec) * 1e3 + (b.tv_nsec - a.tv_nsec) / 1e6;
  LOGF("[red] esperas de 10 ms: poll %.1f · select %.1f · sceKernelUsleep %.1f ms\n", ms[0], ms[1], ms[2]);
}


// Para net.c (título): el nombre resuelto por el resolvedor de la consola, para dárselo hecho a curl (CURLOPT_RESOLVE):
// el hilo de DNS de curl avisa al acabar por un socketpair que en un título no despierta (2-3 s por petición).
int title_resolve(const char *host, char *ip, size_t len) {
  struct in_addr a;
  if(inet_pton(AF_INET, host, &a) == 1 || resolve(host, &a) == 0) return inet_ntop(AF_INET, &a, ip, (socklen_t)len) ? 0 : -1;
  return -1;
}

// Un descriptor cerrado se reutiliza (un archivo, un pipe…): se olvida que era un socket no bloqueante.
int __real_close(int fd);
int __wrap_close(int fd) { if(fd >= 0 && fd < NB_MAX) nonblock[fd] = 0; return __real_close(fd); }
