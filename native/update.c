/* update.c — actualizaciones firmadas para todas las plataformas (docs/updates.md, «Cliente (nativo)»).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Lo instalado vive en <data>/update/:
 *   active                 "<huella>/<seq>": la versión con la que se arranca (la escribe ps.upd_activate)
 *   <huella>/<seq>/        shim/… y game/… de esa versión (todos los archivos de su version.json)
 *   <huella>/assets/       game/assets/… que no son como los del binario (packs.json: se sacan de los packs de update/packs/)
 *   booting                arranques seguidos sin llegar al menú (anti-bucle); bad: la versión que se apartó
 *   <huella>/native/<seq>/ el binario de escritorio bajado (el programa sin el juego: native/<id> del manifiesto)
 *   native                 "<huella>/<seq>": el binario bajado al que se pasa el binario instalado al arrancar (exec);
 *                          native-booting / native-bad: su anti-bucle, como booting / bad
 * Nunca se escribe en la carpeta instalada (.app, Program Files, AppImage: puede ser de sólo lectura): el instalado hace de
 * lanzador y, con POKESURVIVOR_ROOT, el bajado lee el juego de la misma carpeta.
 * Al leer <root>/shim/… o <root>/game/… (main.c, tiles_worker.c, canvas.c) upd_path da la copia instalada si existe.
 * Bajar, comprobar hashes y escribir va en un hilo con curl; el JS (shim/update.js) comprueba la firma y decide.
 * Ed25519 y SHA-512: Monocypher (third_party/monocypher, BSD-2/CC0).
 */
// @step nupdate/handoff
// @step nupdate/handoff
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <errno.h>
#include <pthread.h>
#include <sys/stat.h>
#include <dirent.h>
#include <unistd.h>
#include <curl/curl.h>
#include <limits.h>
#ifdef _WIN32
#include <windows.h>
#endif
#ifdef __APPLE__
#include <TargetConditionals.h>
#include <mach-o/dyld.h>
#endif
#include "quickjs.h"
#include "update.h"
#include "net.h"
#include "monocypher.h"
#include "monocypher-ed25519.h"

// @step nupdate/gate
#define UPD_API 3   // (2: packs, ps.upd_install con offset; 3: binario bajado, ps.upd_native) sube cuando el JS de una actualización necesita algo nuevo del binario (minNative del manifiesto)

static char root_s[512], data_s[512], upd_dir[600], code_dir[700], asset_dir[700], active_s[96], bad_s[96];
// El binario de escritorio que se puede actualizar (native/<id> del manifiesto; tools/sign-update.mjs --native lo publica
// con las mismas rutas): NATIVE_EXE, relativo a la carpeta del programa (la del ejecutable, NATIVE_UP tramos más arriba).
#if defined(__APPLE__) && TARGET_OS_OSX
#define NATIVE_ID "macos"   // (universal: Intel y Apple Silicon en el mismo binario, package-macos.sh)
#elif defined(_WIN32) && defined(__x86_64__)
#define NATIVE_ID "windows-x64"
#elif defined(__linux__) && !defined(__ANDROID__) && defined(__x86_64__)
#define NATIVE_ID "linux-x64"
#endif
#if defined(__APPLE__)
#define NATIVE_SUB "PokeSurvivor.app/"   // (la copia bajada también es un .app: icono, nombre y alta resolución)
#define NATIVE_EXE "Contents/MacOS/PokeSurvivor"
#define NATIVE_UP 3
#elif defined(_WIN32)
#define NATIVE_SUB ""
#define NATIVE_EXE "PokeSurvivor.exe"
#define NATIVE_UP 1
#else
#define NATIVE_SUB ""
#define NATIVE_EXE "usr/bin/pokesurvivor"   // (AppImage y la carpeta de package-linux.sh)
#define NATIVE_UP 3
#endif

static long long base_seq;
static char prog_s[PATH_MAX], native_s[96];
static long long my_native;   // el seq del binario bajado que corre (POKESURVIVOR_NATIVE); 0: el instalado   // el sello del paquete (<root>/update.seq, tools/stage-game.sh); 0: sin actualizaciones
static void (*say)(const char *fmt, ...);

// ---------------- archivos ----------------

static int
mkdir1(const char *p) {
#ifdef _WIN32
  return mkdir(p);
#else
  return mkdir(p, 0777);
#endif
}

// mkdir -p de la carpeta que contiene path.
static void
mkparents(const char *path) {
  char b[800];
  snprintf(b, sizeof b, "%s", path);
  for(char *s = b + 1; *s; s++) if(*s == '/') { *s = 0; mkdir1(b); *s = '/'; }
}

static int
replace(const char *tmp, const char *to) {
#ifdef _WIN32   // (rename no reemplaza en Windows; como js_writeFile de main.c)
  return MoveFileExA(tmp, to, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) ? 0 : -1;
#else
  return rename(tmp, to);
#endif
}

// Escribe entero o nada (temporal + renombrar).
static int
put_file(const char *path, const void *buf, size_t n) {
  char tmp[820];
  FILE *f;
  snprintf(tmp, sizeof tmp, "%s.tmp", path);
  mkparents(path);
  if(!(f = fopen(tmp, "wb"))) return -1;
  int ok = fwrite(buf, 1, n, f) == n;
  ok = fclose(f) == 0 && ok;
  if(!ok || replace(tmp, path)) { remove(tmp); return -1; }
  return 0;
}

static int
read_small(const char *path, char *out, size_t n) {
  FILE *f = fopen(path, "rb");
  size_t k;
  if(!f) { out[0] = 0; return -1; }
  k = fread(out, 1, n - 1, f);
  fclose(f);
  while(k && (out[k - 1] == '\n' || out[k - 1] == '\r' || out[k - 1] == ' ')) k--;
  out[k] = 0;
  return 0;
}

static void
rmtree(const char *path) {
  DIR *d = opendir(path);
  struct dirent *e;
  struct stat st;
  char p[820];
  if(!d) { remove(path); return; }
  while((e = readdir(d))) {
    if(!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    snprintf(p, sizeof p, "%s/%s", path, e->d_name);
    if(stat(p, &st) == 0 && S_ISDIR(st.st_mode)) rmtree(p); else remove(p);
  }
  closedir(d);
  rmdir(path);
}

// ---------------- base64 y hashes ----------------

static void
b64(const uint8_t *in, size_t n, char *out) {
  static const char T[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  size_t i = 0, o = 0;
  for(; i + 2 < n; i += 3) {
    uint32_t v = in[i] << 16 | in[i + 1] << 8 | in[i + 2];
    out[o++] = T[v >> 18]; out[o++] = T[v >> 12 & 63]; out[o++] = T[v >> 6 & 63]; out[o++] = T[v & 63];
  }
  if(i < n) {
    uint32_t v = in[i] << 16 | (i + 1 < n ? in[i + 1] << 8 : 0);
    out[o++] = T[v >> 18]; out[o++] = T[v >> 12 & 63];
    out[o++] = i + 1 < n ? T[v >> 6 & 63] : '='; out[o++] = '=';
  }
  out[o] = 0;
}

// base64 o base64url, con o sin '='. Devuelve los bytes escritos, o -1 si hay algo raro o no cabe.
static int
unb64(const char *s, uint8_t *out, size_t max) {
  uint32_t v = 0;
  int bits = 0;
  size_t o = 0;
  for(; *s && *s != '='; s++) {
    int c = *s;
    int d = c >= 'A' && c <= 'Z' ? c - 'A' : c >= 'a' && c <= 'z' ? c - 'a' + 26 : c >= '0' && c <= '9' ? c - '0' + 52
          : c == '+' || c == '-' ? 62 : c == '/' || c == '_' ? 63 : -1;
    if(d < 0) { if(c == '\n' || c == '\r') continue; return -1; }
    v = v << 6 | d; bits += 6;
    if(bits >= 8) { bits -= 8; if(o >= max) return -1; out[o++] = v >> bits & 255; }
  }
  return (int)o;
}

// SHA-512 de un archivo en base64 (como sign-update.mjs); -1 si no se puede leer.
static long long
sha_file(const char *path, char out[90]) {
  crypto_sha512_ctx c;
  uint8_t buf[65536], h[64];
  long long total = 0;
  size_t k;
  FILE *f = fopen(path, "rb");
  if(!f) return -1;
  crypto_sha512_init(&c);
  while((k = fread(buf, 1, sizeof buf, f)) > 0) { crypto_sha512_update(&c, buf, k); total += k; }
  fclose(f);
  crypto_sha512_final(&c, h);
  b64(h, 64, out);
  return total;
}

static int
same_file(const char *path, const char *sha, long long size) {
  char h[90];
  struct stat st;
  return path && path[0] && stat(path, &st) == 0 && st.st_size == size && sha_file(path, h) == size && !strcmp(h, sha);
}

// ---------------- arranque: de dónde se lee ----------------

// "<hex>/<dígitos>", nada más (viene de un archivo del disco: que no se salga de update/).
static int
valid_active(const char *s) {
  const char *slash = strchr(s, '/');
  if(!slash || slash == s || !slash[1] || strlen(s) > 80) return 0;
  for(const char *p = s; *p; p++) if(p != slash && !(p < slash ? strchr("0123456789abcdef", *p) && *p : *p >= '0' && *p <= '9')) return 0;
  return 1;
}

static void
setenv1(const char *k, const char *v) {
#ifdef _WIN32
  _putenv_s(k, v);
#else
  setenv(k, v, 1);
#endif
}

void
upd_exec(const char *exe, char **argv) {
#ifdef _WIN32
  // (el execv de MSVCRT no pone comillas: con un espacio en la ruta, el nuevo recibía otros argv)
  char self[MAX_PATH], cmd[8192];
  size_t o = 0;
  STARTUPINFOA si = { sizeof si };
  PROCESS_INFORMATION pi;
  if(!exe) { DWORD k = GetModuleFileNameA(NULL, self, sizeof self); if(!k || k >= sizeof self) return; exe = self; }
  for(int i = 0; argv[i]; i++) {
    o += snprintf(cmd + o, sizeof cmd - o, "%s\"%s\"", i ? " " : "", i ? argv[i] : exe);
    if(o >= sizeof cmd) return;
  }
  if(!CreateProcessA(exe, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) return;
  CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
  ExitProcess(0);
#else
  execv(exe ? exe : argv[0], argv);
#endif
}

#ifdef NATIVE_ID
// La carpeta del programa que corre (la de NATIVE_EXE); "" si no tiene esa forma (just run: sin binario que actualizar).
static void
find_prog(void) {
  char p[PATH_MAX], q[PATH_MAX + 40];
  struct stat st;
#if defined(__APPLE__)
  char raw[PATH_MAX];
  uint32_t sz = sizeof raw;
  if(_NSGetExecutablePath(raw, &sz) || !realpath(raw, p)) return;
#elif defined(_WIN32)
  DWORD k = GetModuleFileNameA(NULL, p, sizeof p);
  if(!k || k >= sizeof p) return;
  for(char *c = p; *c; c++) if(*c == '\\') *c = '/';
#else
  ssize_t k = readlink("/proc/self/exe", p, sizeof p - 1);
  if(k <= 0) return;
  p[k] = 0;
#endif
  for(int i = 0; i < NATIVE_UP; i++) { char *c = strrchr(p, '/'); if(!c) return; *c = 0; }
  snprintf(q, sizeof q, "%s/" NATIVE_EXE, p);
  if(stat(q, &st) == 0) snprintf(prog_s, sizeof prog_s, "%s", p);
}

// Si hay un binario bajado más nuevo que éste (y que el paquete), se le pasa el control. Si vuelve, se sigue con éste.
static void
// @step nupdate/handoff decision "¿Binario bajado nuevo?"
// Sólo escritorio: si <data>/update/native es más nuevo, exec con POKESURVIVOR_ROOT; anti-bucle
// native-booting/native-bad.
// @next active "no"
// @next seq "sí: exec"
native_handoff(char **argv) {
  char path[700], n[32], bad[96], exe[900], seqs[32];
  const char *env = getenv("POKESURVIVOR_NATIVE");
  my_native = env ? atoll(env) : 0;
  snprintf(path, sizeof path, "%s/native", upd_dir);
  read_small(path, native_s, sizeof native_s);
  if(!native_s[0] || !valid_active(native_s)) { native_s[0] = 0; return; }
  long long seq = atoll(strchr(native_s, '/') + 1);
  if(seq <= (my_native ? my_native : base_seq) || !argv || !argv[0]) return;   // (ya es éste, o el paquete es más nuevo)
  snprintf(path, sizeof path, "%s/native-bad", upd_dir);
  read_small(path, bad, sizeof bad);
  if(!strcmp(bad, native_s)) return;
  snprintf(path, sizeof path, "%s/native-booting", upd_dir);
  read_small(path, n, sizeof n);
  if(atoi(n) >= 2) {
    say("[update] el binario %s no llegó al menú %d veces: se aparta y sigue el instalado\n", native_s, atoi(n));
    put_file(path, "0", 1);
    snprintf(path, sizeof path, "%s/native-bad", upd_dir);
    put_file(path, native_s, strlen(native_s));
    return;
  }
  snprintf(n, sizeof n, "%d", atoi(n) + 1);
  put_file(path, n, strlen(n));
  snprintf(exe, sizeof exe, "%s/%.*s/native/%lld/" NATIVE_SUB NATIVE_EXE, upd_dir, (int)(strchr(native_s, '/') - native_s), native_s, seq);
  snprintf(seqs, sizeof seqs, "%lld", seq);
  setenv1("POKESURVIVOR_ROOT", root_s);   // (el juego, de la carpeta instalada)
  setenv1("POKESURVIVOR_NATIVE", seqs);
  say("[update] se pasa al binario %s\n", native_s);
  char *self = argv[0];
  argv[0] = exe;
  upd_exec(exe, argv);
  argv[0] = self;   // (ps.relaunch vuelve a abrir argv[0])
  say("[update] no se pudo abrir %s: sigue el instalado\n", exe);
}
#endif


void
upd_init(const char *root, const char *data, void (*log)(const char *fmt, ...), char **argv) {
  char path[700], n[32];
  struct stat st;
  say = log;
  snprintf(root_s, sizeof root_s, "%s", root);
  snprintf(data_s, sizeof data_s, "%s", data);
  snprintf(upd_dir, sizeof upd_dir, "%s/update", data);
  snprintf(path, sizeof path, "%s/bad", upd_dir);
  read_small(path, bad_s, sizeof bad_s);
  snprintf(path, sizeof path, "%s/update.seq", root);
  read_small(path, n, sizeof n);
  // @step nupdate/seq decision "¿Hay update.seq?"
  // upd_init lee <root>/update.seq; sin él (just run) no hay actualizaciones.
  // @next handoff "sí"
  // @next jsinit "no: sale"
  base_seq = atoll(n);
  if(!base_seq) { say("[update] sin update.seq (los archivos del repo: just run): sin actualizaciones\n"); return; }
#ifdef NATIVE_ID
  find_prog();
  native_handoff(argv);   // (antes del anti-bucle del código: el binario al que se pasa cuenta sus propios arranques)
#else
  (void)argv;
#endif
  snprintf(path, sizeof path, "%s/active", upd_dir);
  read_small(path, active_s, sizeof active_s);
  if(!active_s[0]) return;
  if(valid_active(active_s) && atoll(strchr(active_s, '/') + 1) <= base_seq) {   // (un binario nuevo sobre una caché vieja)
    say("[update] el juego (%lld) es más nuevo que la versión instalada %s: la del binario\n", base_seq, active_s);
    active_s[0] = 0;
    return;
  }
  snprintf(code_dir, sizeof code_dir, "%s/%s", upd_dir, active_s);
  if(!valid_active(active_s) || stat(code_dir, &st) || !S_ISDIR(st.st_mode)) {
    say("[update] versión instalada no válida (%s): la del binario\n", active_s);
    active_s[0] = code_dir[0] = 0;
    return;
  }
  // Anti-bucle: dos arranques seguidos sin llegar al menú → esa versión se aparta y se arranca con la del binario.
  snprintf(path, sizeof path, "%s/booting", upd_dir);
  read_small(path, n, sizeof n);
  int tries = atoi(n);
  // @step nupdate/active decision "Versión activa"
  // active válida y más nueva que update.seq → se usa; 2 arranques sin llegar al menú → bad.
  // @next path "válida"
  if(tries >= 2) {
    say("[update] %s no llegó al menú %d veces: se aparta y se arranca con la del binario\n", active_s, tries);
    put_file(path, "0", 1);
    snprintf(path, sizeof path, "%s/bad", upd_dir);
    put_file(path, active_s, strlen(active_s));
    snprintf(bad_s, sizeof bad_s, "%s", active_s);
    snprintf(path, sizeof path, "%s/active", upd_dir);
    remove(path);
    active_s[0] = code_dir[0] = 0;
    return;
  }
  snprintf(n, sizeof n, "%d", tries + 1);
  put_file(path, n, strlen(n));
  snprintf(asset_dir, sizeof asset_dir, "%s/%.*s/assets", upd_dir, (int)(strchr(active_s, '/') - active_s), active_s);
  say("[update] arranca con la versión instalada %s\n", active_s);
}

const char *
// @step nupdate/path data "upd_path"
// Lecturas de shim/ y game/ van a la copia instalada; assets a <huella>/assets.
// @next jsinit
upd_path(const char *path, char *buf, size_t n) {
  size_t rl = strlen(root_s);
  const char *rel, *base;
  struct stat st;
  if(!code_dir[0] || !path || strncmp(path, root_s, rl) || path[rl] != '/') return path;
  rel = path + rl + 1;
  base = !strncmp(rel, "game/assets/", 12) ? asset_dir : !strncmp(rel, "shim/", 5) || !strncmp(rel, "game/", 5) ? code_dir : NULL;
  if(!base || strstr(rel, "..")) return path;
  snprintf(buf, n, "%s/%s", base, rel);
  return stat(buf, &st) == 0 ? buf : path;
}

// ---------------- el hilo: bajar y escribir ----------------

typedef struct { char *url, *dest, *sha, *alt; long long size, off, pack; int skip; } job_t;   // off < 0: url es el archivo
static pthread_mutex_t mx = PTHREAD_MUTEX_INITIALIZER;
static int busy, finished, ok_res;
static long done_n, total_n;
static char err_s[300];
static uint8_t *got;      // lo bajado por upd_get
static size_t got_n, got_max;
static job_t *jobs;
static uint8_t *pk;       // el último pack bajado (url pk_url), entero en memoria (~2 MB)
static size_t pk_n;
static char *pk_url;

typedef struct { uint8_t *buf; size_t n, max; FILE *f; crypto_sha512_ctx sha; int over; } sink_t;

static size_t
on_body(char *p, size_t sz, size_t nm, void *u) {
  sink_t *s = u;
  size_t k = sz * nm;
  if(s->n + k > s->max) { s->over = 1; return 0; }
  if(s->f) { if(fwrite(p, 1, k, s->f) != k) return 0; crypto_sha512_update(&s->sha, (uint8_t*)p, k); }
  else memcpy(s->buf + s->n, p, k);
  s->n += k;
  return k;
}

// GET a memoria (buf != NULL) o a un archivo abierto. 0 si llegó un 200 entero y cabía.
static int
fetch(const char *url, sink_t *s, char *err, size_t en) {
  CURL *e = curl_easy_init();
  long code = 0;
  CURLcode rc;
  if(!e) { snprintf(err, en, "curl"); return -1; }
  curl_easy_setopt(e, CURLOPT_URL, url);
  curl_easy_setopt(e, CURLOPT_WRITEFUNCTION, on_body);
  curl_easy_setopt(e, CURLOPT_WRITEDATA, s);
  curl_easy_setopt(e, CURLOPT_FOLLOWLOCATION, 0L);   // (docs/updates.md: sin redirecciones; lo publicado se sirve tal cual)
#if LIBCURL_VERSION_NUM >= 0x075500
  curl_easy_setopt(e, CURLOPT_PROTOCOLS_STR, "https");
#else
  curl_easy_setopt(e, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
#endif
  curl_easy_setopt(e, CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(e, CURLOPT_CONNECTTIMEOUT_MS, 15000L);
  curl_easy_setopt(e, CURLOPT_LOW_SPEED_LIMIT, 64L);   // parado 30 s: se corta
  curl_easy_setopt(e, CURLOPT_LOW_SPEED_TIME, 30L);
  curl_easy_setopt(e, CURLOPT_USERAGENT, "PokeSurvivor-update");
  net_easy_setup(e, url);
  rc = curl_easy_perform(e);
  curl_easy_getinfo(e, CURLINFO_RESPONSE_CODE, &code);
  curl_easy_cleanup(e);
  if(s->over) { snprintf(err, en, "%s: más grande de lo esperado", url); return -1; }
  if(rc != CURLE_OK) { snprintf(err, en, "%s: %s", url, curl_easy_strerror(rc)); return -1; }
  if(code != 200) { snprintf(err, en, "%s: HTTP %ld", url, code); return -1; }
  return 0;
}

static int
copy_file(const char *from, const char *to) {
  FILE *a = fopen(from, "rb"), *b;
  char tmp[820], buf[65536];
  size_t k;
  int ok = 1;
  if(!a) return -1;
  snprintf(tmp, sizeof tmp, "%s.tmp", to);
  mkparents(to);
  if(!(b = fopen(tmp, "wb"))) { fclose(a); return -1; }
  while(ok && (k = fread(buf, 1, sizeof buf, a)) > 0) ok = fwrite(buf, 1, k, b) == k;
  fclose(a);
  ok = fclose(b) == 0 && ok;
  if(!ok || replace(tmp, to)) { remove(tmp); return -1; }
  return 0;
}

// De un pack (j->url, de j->pack bytes) el trozo [off, off + size): se baja el pack si no es el de antes, y el trozo se
// comprueba (tamaño y hash) antes de escribirlo.
static int
// @step nupdate/install
from_pack(job_t *j, char *err, size_t en) {
  uint8_t d[64];
  char h[90];
  if(!pk_url || strcmp(pk_url, j->url)) {
    sink_t s = { .max = (size_t)j->pack };
    free(pk); free(pk_url); pk = NULL; pk_url = NULL; pk_n = 0;
    if(!(s.buf = malloc(s.max))) { snprintf(err, en, "sin memoria para %s", j->url); return -1; }
    if(fetch(j->url, &s, err, en)) { free(s.buf); return -1; }
    pk = s.buf; pk_n = s.n; pk_url = strdup(j->url);
  }
  if(j->off + j->size > (long long)pk_n) { snprintf(err, en, "%s: más corto de lo esperado", j->url); return -1; }
  crypto_sha512(d, pk + j->off, (size_t)j->size);
  b64(d, 64, h);
  if(strcmp(h, j->sha)) { snprintf(err, en, "%s: el hash de %s no coincide", j->url, j->dest); return -1; }
  if(put_file(j->dest, pk + j->off, (size_t)j->size)) { snprintf(err, en, "no se puede escribir %s", j->dest); return -1; }
  return 0;
}

// Un archivo: si ya está bien, nada; si una copia local (alt) es igual, se copia (o, con skip, se usa la del binario y
// sobra la instalada); si no, se baja, comprobando tamaño y hash antes de ponerlo en su sitio.
static int
one(job_t *j, char *err, size_t en) {
  char tmp[820], h[90];
  uint8_t d[64];
  sink_t s = { 0 };
  if(same_file(j->dest, j->sha, j->size)) return 0;
  if(same_file(j->alt, j->sha, j->size)) {
    if(j->skip) { remove(j->dest); return 0; }
    if(!copy_file(j->alt, j->dest) && same_file(j->dest, j->sha, j->size)) return 0;
  }
  if(j->off >= 0) return from_pack(j, err, en);
  snprintf(tmp, sizeof tmp, "%s.part", j->dest);
  mkparents(j->dest);
  if(!(s.f = fopen(tmp, "wb"))) { snprintf(err, en, "no se puede escribir %.250s", tmp); return -1; }
  s.max = (size_t)j->size;
  crypto_sha512_init(&s.sha);
  int rc = fetch(j->url, &s, err, en);
  if(fclose(s.f)) rc = -1;
  crypto_sha512_final(&s.sha, d);
  b64(d, 64, h);
  if(!rc && ((long long)s.n != j->size || strcmp(h, j->sha))) { snprintf(err, en, "%s: el hash no coincide", j->url); rc = -1; }
  if(!rc && replace(tmp, j->dest)) { snprintf(err, en, "no se puede escribir %s", j->dest); rc = -1; }
  if(rc) remove(tmp);
  return rc;
}

static void
finish(int ok, const char *err) {
  pthread_mutex_lock(&mx);
  ok_res = ok; finished = 1; busy = 0;
  snprintf(err_s, sizeof err_s, "%s", err ? err : "");
  pthread_mutex_unlock(&mx);
}

static void*
get_thread(void *arg) {
  char *url = arg, err[300] = "";
  sink_t s = { .buf = got, .max = got_max };
  int rc = fetch(url, &s, err, sizeof err);
  got_n = s.n;
  free(url);
  finish(!rc, err);
  return NULL;
}

static void*
// @step nupdate/install
install_thread(void *arg) {
  char err[300] = "";
  long n = (long)(intptr_t)arg;
  int rc = 0;
  for(long i = 0; i < n && !rc; i++) {
    rc = one(&jobs[i], err, sizeof err);
    pthread_mutex_lock(&mx); done_n = i + 1; pthread_mutex_unlock(&mx);
  }
  for(long i = 0; i < n; i++) { free(jobs[i].url); free(jobs[i].dest); free(jobs[i].sha); free(jobs[i].alt); }
  free(jobs); jobs = NULL;
  free(pk); free(pk_url); pk = NULL; pk_url = NULL; pk_n = 0;
  finish(!rc, err);
  return NULL;
}

static int
start(void *(*fn)(void*), void *arg) {
  pthread_t t;
  if(pthread_create(&t, NULL, fn, arg)) return -1;
  pthread_detach(t);
  return 0;
}

// Sólo dentro de <data>/update/ y sin «..».
static int
inside(const char *p) {
  size_t n = strlen(upd_dir);
  return p && !strncmp(p, upd_dir, n) && p[n] == '/' && !strstr(p, "..");
}

// ---------------- lo que ve el JS ----------------

static int
claim(void) {
  int ok;
  pthread_mutex_lock(&mx);
  ok = !busy;
  if(ok) { busy = 1; finished = 0; done_n = total_n = 0; err_s[0] = 0; }
  pthread_mutex_unlock(&mx);
  return ok;
}

// ps.upd_get(url, máx. bytes) -> true si empezó (el resultado, en ps.upd_poll).
static JSValue
js_get(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *url = JS_ToCString(ctx, argv[0]);
  double max = 0;
  JS_ToFloat64(ctx, &max, argv[1]);
  int ok = url && !strncmp(url, "https://", 8) && max > 0 && max <= 64 << 20 && claim();
  if(ok) {
    free(got); got_n = 0; got_max = (size_t)max;
    char *u = strdup(url);
    if(!(got = malloc(got_max ? got_max : 1)) || !u || start(get_thread, u)) { free(u); finish(0, "sin memoria o sin hilo"); }
  }
  JS_FreeCString(ctx, url);
  return JS_NewBool(ctx, ok);
}

static char*
str_at(JSContext *ctx, JSValueConst a, int i) {
  JSValue v = JS_GetPropertyUint32(ctx, a, i);
  const char *s = JS_IsString(v) ? JS_ToCString(ctx, v) : NULL;
  char *r = s ? strdup(s) : NULL;
  JS_FreeCString(ctx, s);
  JS_FreeValue(ctx, v);
  return r;
}

// ps.upd_install([[url, destino, sha512, tamaño, copia local|null, skip, offset?, tamaño del pack?], …]) -> true si empezó.
// Destinos: en <data>/update/. Con offset, url es un pack y el archivo es su trozo [offset, offset + tamaño) (packs.json);
// los trabajos del mismo pack, seguidos (el pack se baja una vez).
static JSValue
js_install(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  JSValue lv = JS_GetPropertyStr(ctx, argv[0], "length");
  int64_t n = 0;
  JS_ToInt64(ctx, &n, lv);
  JS_FreeValue(ctx, lv);
  if(n <= 0 || n > 100000 || !claim()) return JS_FALSE;
  jobs = calloc(n, sizeof *jobs);
  int bad = !jobs;
  for(int64_t i = 0; i < n && !bad; i++) {
    JSValue it = JS_GetPropertyUint32(ctx, argv[0], i), v;
    job_t *j = &jobs[i];
    j->url = str_at(ctx, it, 0); j->dest = str_at(ctx, it, 1); j->sha = str_at(ctx, it, 2); j->alt = str_at(ctx, it, 4);
    v = JS_GetPropertyUint32(ctx, it, 3); JS_ToInt64(ctx, (int64_t*)&j->size, v); JS_FreeValue(ctx, v);
    v = JS_GetPropertyUint32(ctx, it, 5); j->skip = JS_ToBool(ctx, v); JS_FreeValue(ctx, v);
    j->off = -1;
    v = JS_GetPropertyUint32(ctx, it, 6);
    if(!JS_IsUndefined(v)) { JS_ToInt64(ctx, (int64_t*)&j->off, v); JS_FreeValue(ctx, v); v = JS_GetPropertyUint32(ctx, it, 7); JS_ToInt64(ctx, (int64_t*)&j->pack, v); }
    JS_FreeValue(ctx, v);
    JS_FreeValue(ctx, it);
    bad = !j->url || strncmp(j->url, "https://", 8) || !inside(j->dest) || !j->sha || j->size < 0
       || (j->off != -1 && (j->off < 0 || j->pack <= 0 || j->pack > 64 << 20 || j->off + j->size > j->pack));
  }
  if(bad) {
    if(jobs) for(int64_t i = 0; i < n; i++) { free(jobs[i].url); free(jobs[i].dest); free(jobs[i].sha); free(jobs[i].alt); }
    free(jobs); jobs = NULL;
    finish(0, "trabajos no válidos");
    return JS_FALSE;
  }
  total_n = (long)n;
  if(start(install_thread, (void*)(intptr_t)n)) { finish(0, "sin hilo"); return JS_FALSE; }
  return JS_TRUE;
}

// ps.upd_poll() -> undefined (nada), {run, done, total} (trabajando) o {ok, data?, text?, err} (una vez, al acabar).
static JSValue
js_poll(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  JSValue o = JS_UNDEFINED;
  pthread_mutex_lock(&mx);
  if(busy) {
    o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "run", JS_TRUE);
    JS_SetPropertyStr(ctx, o, "done", JS_NewInt64(ctx, done_n));
    JS_SetPropertyStr(ctx, o, "total", JS_NewInt64(ctx, total_n));
  } else if(finished) {
    finished = 0;
    o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "ok", JS_NewBool(ctx, ok_res));
    JS_SetPropertyStr(ctx, o, "err", JS_NewString(ctx, err_s));
    if(ok_res && got) {   // (y como texto: decodificar 2 MB de packs.json en JS eran segundos)
      JS_SetPropertyStr(ctx, o, "data", JS_NewArrayBufferCopy(ctx, got, got_n));
      JS_SetPropertyStr(ctx, o, "text", JS_NewStringLen(ctx, (const char*)got, got_n));
      free(got); got = NULL;
    }
  }
  pthread_mutex_unlock(&mx);
  return o;
}

static const uint8_t*
bytes(JSContext *ctx, JSValueConst v, size_t *n) {
  const uint8_t *p = JS_GetArrayBuffer(ctx, n, v);
  if(!p) JS_FreeValue(ctx, JS_GetException(ctx));
  return p;
}

// ps.sha512(ArrayBuffer) -> base64.
static JSValue
js_sha512(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  size_t n;
  const uint8_t *p = bytes(ctx, argv[0], &n);
  uint8_t h[64];
  char out[90];
  if(!p) return JS_NULL;
  crypto_sha512(h, p, n);
  b64(h, 64, out);
  return JS_NewString(ctx, out);
}

// ps.ed25519_ok(clave base64url, mensaje ArrayBuffer, firma base64) -> true sólo si la firma es buena.
static JSValue
// @step nupdate/manifest
js_ed25519_ok(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *k = JS_ToCString(ctx, argv[0]), *s = JS_ToCString(ctx, argv[2]);
  uint8_t key[33], sig[65];
  size_t n;
  const uint8_t *m = bytes(ctx, argv[1], &n);
  int ok = k && s && m && unb64(k, key, sizeof key) == 32 && unb64(s, sig, sizeof sig) == 64 && crypto_ed25519_check(sig, key, m, n) == 0;
  JS_FreeCString(ctx, k);
  JS_FreeCString(ctx, s);
  return JS_NewBool(ctx, ok);
}

// ps.upd_activate("<huella>/<seq>"): la versión con la que se arrancará la próxima vez (y booting a 0).
static JSValue
// @step nupdate/activate
js_activate(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *s = JS_ToCString(ctx, argv[0]);
  char path[700];
  int ok = s && valid_active(s);
  if(ok) {
    snprintf(path, sizeof path, "%s/booting", upd_dir); put_file(path, "0", 1);
    snprintf(path, sizeof path, "%s/active", upd_dir); ok = !put_file(path, s, strlen(s));
  }
  JS_FreeCString(ctx, s);
  return JS_NewBool(ctx, ok);
}

// ps.upd_booted(): el juego llegó al menú (anti-bucle).
static JSValue
js_booted(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  char path[700];
  if(active_s[0]) { snprintf(path, sizeof path, "%s/booting", upd_dir); put_file(path, "0", 1); }
  if(my_native) { snprintf(path, sizeof path, "%s/native-booting", upd_dir); put_file(path, "0", 1); }
  return JS_UNDEFINED;
}

// ps.upd_prune(carpeta, a, b): borra las versiones de <data>/update/<huella>/ que no sean a ni b (ni assets).
static JSValue
js_prune(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *dir = JS_ToCString(ctx, argv[0]), *a = JS_ToCString(ctx, argv[1]), *b = argc > 2 ? JS_ToCString(ctx, argv[2]) : NULL;
  DIR *d = dir && inside(dir) ? opendir(dir) : NULL;
  struct dirent *e;
  char p[820];
  if(d) {
    while((e = readdir(d))) {
      const char *nm = e->d_name;
      if(!nm[0] || strspn(nm, "0123456789") != strlen(nm) || (a && !strcmp(nm, a)) || (b && !strcmp(nm, b))) continue;
      snprintf(p, sizeof p, "%s/%s", dir, nm);
      rmtree(p);
    }
    closedir(d);
  }
  JS_FreeCString(ctx, dir); JS_FreeCString(ctx, a); if(b) JS_FreeCString(ctx, b);
  return JS_UNDEFINED;
}

#ifdef NATIVE_ID
static void
chmod_tree(const char *path) {
#ifndef _WIN32
  DIR *d = opendir(path);
  struct dirent *e;
  struct stat st;
  char p[820];
  if(!d) return;
  while((e = readdir(d))) {
    if(!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    snprintf(p, sizeof p, "%s/%s", path, e->d_name);
    if(stat(p, &st) == 0 && S_ISDIR(st.st_mode)) chmod_tree(p); else chmod(p, 0755);   // (lo bajado llega sin permisos de ejecución)
  }
  closedir(d);
#else
  (void)path;
#endif
}

// ps.upd_native("<huella>/<seq>"): el binario bajado a <huella>/native/<seq>/ es el que se abre desde el próximo arranque.
static JSValue
// @step nupdate/natbin
js_native(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *s = JS_ToCString(ctx, argv[0]);
  char dir[800], exe[900], path[700];
  struct stat st;
  int ok = s && valid_active(s);
  if(ok) {
    snprintf(dir, sizeof dir, "%s/%.*s/native/%s", upd_dir, (int)(strchr(s, '/') - s), s, strchr(s, '/') + 1);
    chmod_tree(dir);
    snprintf(exe, sizeof exe, "%s/" NATIVE_SUB NATIVE_EXE, dir);
    ok = stat(exe, &st) == 0;
  }
  if(ok) {
    snprintf(path, sizeof path, "%s/native-booting", upd_dir); put_file(path, "0", 1);
    snprintf(path, sizeof path, "%s/native", upd_dir); ok = !put_file(path, s, strlen(s));
  }
  JS_FreeCString(ctx, s);
  return JS_NewBool(ctx, ok);
}

// ps.upd_same(ruta, sha512, tamaño) -> ¿ese archivo es así? (el binario que corre frente al del manifiesto)
// ponytail: en el hilo del JS (~20 MB de hash, decenas de ms), sólo cuando llega una versión nueva y en el menú.
static JSValue
js_same(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  const char *p = JS_ToCString(ctx, argv[0]), *h = JS_ToCString(ctx, argv[1]);
  int64_t n = -1;
  JS_ToInt64(ctx, &n, argv[2]);
  int ok = p && h && same_file(p, h, n);
  JS_FreeCString(ctx, p); JS_FreeCString(ctx, h);
  return JS_NewBool(ctx, ok);
}
#endif

void
upd_register(JSContext *ctx, JSValue ps) {
#define FN(name, fn, n) JS_SetPropertyStr(ctx, ps, name, JS_NewCFunction(ctx, fn, name, n))
  FN("sha512", js_sha512, 1);
  FN("ed25519_ok", js_ed25519_ok, 3);
  FN("upd_get", js_get, 2);
  FN("upd_install", js_install, 1);
  FN("upd_poll", js_poll, 0);
  FN("upd_activate", js_activate, 1);
  FN("upd_booted", js_booted, 0);
  FN("upd_prune", js_prune, 3);
#ifdef NATIVE_ID
  if(prog_s[0] && base_seq) {   // ps.NATIVE: sólo un binario instalado con la forma de su paquete
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "id", JS_NewString(ctx, NATIVE_ID));
    JS_SetPropertyStr(ctx, o, "prog", JS_NewString(ctx, prog_s));
    JS_SetPropertyStr(ctx, o, "sub", JS_NewString(ctx, NATIVE_SUB));
    JS_SetPropertyStr(ctx, o, "exe", JS_NewString(ctx, NATIVE_EXE));
    JS_SetPropertyStr(ctx, o, "seq", JS_NewInt64(ctx, my_native));
    JS_SetPropertyStr(ctx, ps, "NATIVE", o);
    FN("upd_native", js_native, 1);
    FN("upd_same", js_same, 3);
  }
#endif
#undef FN
  JS_SetPropertyStr(ctx, ps, "UPD_API", JS_NewInt32(ctx, UPD_API));
  JS_SetPropertyStr(ctx, ps, "UPD_BASE", JS_NewInt64(ctx, base_seq));
  JS_SetPropertyStr(ctx, ps, "UPD_ACTIVE", JS_NewString(ctx, active_s));
  JS_SetPropertyStr(ctx, ps, "UPD_BAD", JS_NewString(ctx, bad_s));
}
