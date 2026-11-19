/* audio.c — lo de Web Audio que usa el juego (js/core/audio.js), en C.
 *
 * El juego sintetiza toda la música y los efectos con un grafo de Web Audio: osciladores,
 * ruido de un búfer, ganancias con envolventes, filtros, un compresor y una reverb. Aquí
 * está ese grafo, mezclado a 48 kHz (mono por dentro, estéreo a la salida) en el hilo de
 * audio de SDL. native/shim/audio.js da al juego el AudioContext de siempre sobre ps.au_*.
 *
 * - Los AudioParam siguen sus eventos (setValueAtTime, rampas, setTargetAtTime) y suman lo
 *   que se les conecte (el vibrato es un oscilador conectado a una frecuencia).
 * - La reverb no es una convolución (1,8 s de respuesta por muestra no cabe): es una
 *   reverb algorítmica tipo Freeverb con la misma cola.
 * - Un nodo se libera cuando el JS ya no lo usa (finalizador de QuickJS) y ha dejado de
 *   sonar: una fuente que terminó, o cualquier otro sin entradas vivas. Como en el navegador.
 *
 * Cooperativo local: cada copia del juego (jugadores 1-4) tiene su salida (el nodo destino d = su número - 1) en el
 * mismo grafo. La del 1 va a la tele (SDL); la de los demás, al altavoz de su mando (PADSPK de su usuario, mono), cada
 * una con su anillo y su hilo, como gb5 (runtime/ps5/audio.c).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <math.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#include <SDL2/SDL.h>
#include "quickjs.h"
#include "audio.h"

#define RATE 48000
#define BLOCK 128
#define MAX_NODES 4096
#define MAX_EVENTS 16
#define NDEST 4      // los destinos: uno por jugador (nodos 0-3)

enum { N_DEST, N_GAIN, N_OSC, N_BUFSRC, N_BIQUAD, N_COMP, N_REVERB, N_NONE };
enum { W_SINE, W_SQUARE, W_SAW, W_TRIANGLE };
enum { F_LOWPASS, F_HIGHPASS, F_BANDPASS };
enum { E_SET, E_LINEAR, E_EXP, E_TARGET };

typedef struct { int type; double t, v, tc; } event_t;

typedef struct {
  double value;              // .value (y el valor de partida antes del primer evento)
  event_t ev[MAX_EVENTS];
  int nev;
  int *in, nin, cin;         // nodos conectados al parámetro (se suman, muestra a muestra)
} param_t;

typedef struct {
  int type, used, js_alive, ever_input;
  int *in, nin, cin;         // entradas de audio
  param_t p[3];              // gain | frequency, detune(sin uso) | frequency, Q | threshold, ratio | playbackRate
  float out[BLOCK];
  Uint64 stamp;              // bloque ya calculado
  // fuentes
  double start, stop;        // en segundos del contexto; stop < 0: sin parar
  int wave;
  double phase;
  float *buf; int buflen; double pos;
  // biquad
  int ftype; double z1, z2;
  // compresor
  double env, cgain;   // compresor: pico seguido y la ganancia que aplica (0 = aún sin empezar)
  // reverb
  float *comb[4], *ap[2]; int clen[4], alen[2], ci[4], ai[2]; double cf[4];
} node_t;

static node_t nodes[MAX_NODES];
static int live[MAX_NODES], nlive;   // los nodos en uso (recorrer 4096 en cada liberación cortaba el audio)
static double mix_ms_max;            // lo que más ha tardado una mezcla (desde la última vez que se miró)
static SDL_AudioDeviceID dev;
static Uint64 block_no;              // bloques calculados desde el arranque
static double now_s;                 // AudioContext.currentTime
static JSClassID handle_class;

// ---------------- AudioParam ----------------

static void
param_init(param_t *p, double v) { memset(p, 0, sizeof *p); p->value = v; }

static void
param_add(param_t *p, int type, double t, double v, double tc) {
  int i;
  // Los eventos ya pasados se resumen en uno (el valor de ahora): así no se llena la lista.
  while(p->nev >= MAX_EVENTS - 1) { memmove(p->ev, p->ev + 1, sizeof(event_t) * --p->nev); }
  i = p->nev;
  while(i > 0 && p->ev[i - 1].t > t) { p->ev[i] = p->ev[i - 1]; i--; }   // en orden de tiempo
  p->ev[i] = (event_t){ type, t, v, tc };
  p->nev++;
}

// El valor en el instante t, según la especificación de Web Audio.
static double
param_at(const param_t *p, double t) {
  double v = p->value, t0 = 0, v0 = p->value;
  int target = -1;   // un setTargetAtTime en curso
  for(int i = 0; i < p->nev; i++) {
    const event_t *e = &p->ev[i];
    if(target >= 0) {   // el valor cuando llega este evento sale de la curva del setTarget
      const event_t *s = &p->ev[target];
      double until = e->t < t ? e->t : t;
      v = s->v + (v0 - s->v) * exp(-(until - s->t) / (s->tc > 1e-6 ? s->tc : 1e-6));
      if(e->t > t) return v;
      target = -1; t0 = e->t; v0 = v;
    }
    if(e->t > t) {
      if(e->type == E_LINEAR) return v0 + (e->v - v0) * (t - t0) / (e->t - t0 > 1e-9 ? e->t - t0 : 1e-9);
      if(e->type == E_EXP && v0 > 0 && e->v > 0) return v0 * pow(e->v / v0, (t - t0) / (e->t - t0 > 1e-9 ? e->t - t0 : 1e-9));
      return v;
    }
    if(e->type == E_TARGET) { target = i; v0 = v; continue; }
    v = e->v; t0 = e->t; v0 = v;
  }
  if(target >= 0) {
    const event_t *s = &p->ev[target];
    v = s->v + (v0 - s->v) * exp(-(t - s->t) / (s->tc > 1e-6 ? s->tc : 1e-6));
  }
  return v;
}

// Los valores de un bloque, muestra a muestra. Si algún evento cae dentro del bloque, se calcula en cada
// muestra; si no, recta entre los dos extremos (exacta en las rampas lineales, casi en las exponenciales).
// Antes era siempre la recta: en el bloque donde empieza una nota, el valor de antes del primer evento (el de
// por defecto, 1) se mezclaba con la subida de 6 ms y cada nota empezaba con un chasquido 10-20 veces más fuerte.
static void
param_block(const param_t *p, double t0, double dt, double *out) {
  double t1 = t0 + BLOCK * dt;
  int inside = 0;
  for(int i = 0; i < p->nev && !inside; i++) inside = p->ev[i].t > t0 && p->ev[i].t < t1;
  if(inside) { for(int k = 0; k < BLOCK; k++) out[k] = param_at(p, t0 + k * dt); return; }
  double a = param_at(p, t0), b = param_at(p, t1);
  for(int k = 0; k < BLOCK; k++) out[k] = a + (b - a) * k / BLOCK;
}

// ---------------- el grafo ----------------

static void
list_add(int **a, int *n, int *cap, int v) {
  for(int i = 0; i < *n; i++) if((*a)[i] == v) return;
  if(*n == *cap) { *cap = *cap ? *cap * 2 : 4; *a = realloc(*a, sizeof(int) * *cap); }
  (*a)[(*n)++] = v;
}

static void
list_del(int *a, int *n, int v) {
  for(int i = 0; i < *n; i++) if(a[i] == v) { a[i] = a[--*n]; return; }
}

static const float *render(int id, int depth);

// Suma de lo que entra (audio o parámetro): mono, un bloque.
static void
sum_inputs(const int *in, int nin, float *acc, int depth) {
  memset(acc, 0, sizeof(float) * BLOCK);
  for(int i = 0; i < nin; i++) {
    const float *b = render(in[i], depth + 1);
    for(int k = 0; k < BLOCK; k++) acc[k] += b[k];
  }
}

static double
blep(double t, double dt) {   // polyBLEP: quita el zumbido de los saltos de la cuadrada y la sierra
  if(t < dt) { t /= dt; return t + t - t * t - 1; }
  if(t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

static const float *
render(int id, int depth) {
  node_t *n = &nodes[id];
  float in[BLOCK], mod[BLOCK];
  double t0 = now_s, dt = 1.0 / RATE;
  if(n->stamp == block_no + 1) return n->out;
  n->stamp = block_no + 1;
  memset(n->out, 0, sizeof n->out);
  if(depth > 32) return n->out;   // un ciclo en el grafo: silencio, no colgarse

  switch(n->type) {
  case N_DEST: case N_GAIN: {
    sum_inputs(n->in, n->nin, in, depth);
    if(n->type == N_DEST) { memcpy(n->out, in, sizeof in); break; }
    sum_inputs(n->p[0].in, n->p[0].nin, mod, depth);
    double g[BLOCK];
    param_block(&n->p[0], t0, dt, g);
    for(int k = 0; k < BLOCK; k++) n->out[k] = in[k] * (float)(g[k] + mod[k]);
    break;
  }
  case N_OSC: {
    sum_inputs(n->p[0].in, n->p[0].nin, mod, depth);
    double fr[BLOCK];
    param_block(&n->p[0], t0, dt, fr);
    for(int k = 0; k < BLOCK; k++) {
      double t = t0 + k * dt, f, inc, ph = n->phase, v;
      if(t < n->start || (n->stop >= 0 && t >= n->stop)) continue;
      f = fr[k] + mod[k];
      inc = f * dt;
      if(inc < 0) inc = 0;
      if(inc > 0.5) inc = 0.5;
      switch(n->wave) {
      case W_SINE: v = sin(ph * 2 * M_PI); break;
      case W_SQUARE: v = (ph < 0.5 ? 1 : -1) + blep(ph, inc) - blep(fmod(ph + 0.5, 1), inc); break;
      case W_SAW: v = 2 * ph - 1 - blep(ph, inc); break;
      default: v = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; break;
      }
      n->out[k] = (float)v;
      n->phase = fmod(ph + inc, 1);
    }
    break;
  }
  case N_BUFSRC: {
    double r0 = param_at(&n->p[0], t0);
    if(!n->buf) break;
    for(int k = 0; k < BLOCK; k++) {
      double t = t0 + k * dt;
      int i;
      if(t < n->start || (n->stop >= 0 && t >= n->stop)) continue;
      i = (int)n->pos;
      if(i >= n->buflen) { n->stop = t; break; }   // se acabó el búfer: termina (sin bucle)
      n->out[k] = n->buf[i];
      n->pos += r0;
    }
    break;
  }
  case N_BIQUAD: {
    // Coeficientes de RBJ (Audio EQ Cookbook) con la frecuencia y Q del principio del bloque.
    double f = param_at(&n->p[0], t0), q = param_at(&n->p[1], t0), w, cs, al, b0, b1, b2, a0, a1, a2;
    sum_inputs(n->in, n->nin, in, depth);
    if(f > RATE * 0.49) f = RATE * 0.49;
    if(f < 10) f = 10;
    if(q < 0.0001) q = 0.0001;
    w = 2 * M_PI * f / RATE; cs = cos(w); al = sin(w) / (2 * q);
    if(n->ftype == F_HIGHPASS) { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else if(n->ftype == F_BANDPASS) { b0 = al; b1 = 0; b2 = -al; }
    else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    for(int k = 0; k < BLOCK; k++) {   // forma directa II traspuesta
      double x = in[k], y = b0 * x + n->z1;
      n->z1 = b1 * x - a1 * y + n->z2;
      n->z2 = b2 * x - a2 * y;
      n->out[k] = (float)y;
    }
    break;
  }
  case N_COMP: {
    // Como el DynamicsCompressorNode del navegador (rodilla de 30 dB, ataque 3 ms, relajación 250 ms).
    // El pico se sigue al instante y baja despacio, y lo que se suaviza es la ganancia: antes el detector
    // seguía la onda misma y, con notas agudas, la ganancia subía y bajaba con ella (sonaba "crispy").
    const double KNEE = 30;
    double thr = param_at(&n->p[0], t0), ratio = param_at(&n->p[1], t0);
    double att = 1 - exp(-1.0 / (0.003 * RATE)), rel = 1 - exp(-1.0 / (0.25 * RATE)), fall = exp(-1.0 / (0.25 * RATE));
    sum_inputs(n->in, n->nin, in, depth);
    if(ratio < 1) ratio = 1;
    if(n->cgain <= 0) n->cgain = 1;
    for(int k = 0; k < BLOCK; k++) {
      double a = fabs(in[k]), over, red, target;
      n->env = a > n->env ? a : n->env * fall;
      over = 20 * log10(n->env + 1e-9) - thr;
      if(over <= -KNEE / 2) red = 0;
      else if(over < KNEE / 2) red = (1 / ratio - 1) * (over + KNEE / 2) * (over + KNEE / 2) / (2 * KNEE);
      else red = (1 / ratio - 1) * over;
      target = pow(10, red / 20);
      n->cgain += (target - n->cgain) * (target < n->cgain ? att : rel);
      n->out[k] = (float)(in[k] * n->cgain);
    }
    break;
  }
  case N_REVERB: {
    // Freeverb reducido: 4 peines en paralelo y 2 pasa-todo en serie. ~1,8 s de cola, como la del juego.
    sum_inputs(n->in, n->nin, in, depth);
    for(int k = 0; k < BLOCK; k++) {
      double x = in[k] * 0.06, y = 0;
      for(int c = 0; c < 4; c++) {
        float *b = n->comb[c];
        double o = b[n->ci[c]];
        n->cf[c] = o * 0.75 + n->cf[c] * 0.25;          // amortiguación
        b[n->ci[c]] = (float)(x + n->cf[c] * 0.86);
        if(++n->ci[c] >= n->clen[c]) n->ci[c] = 0;
        y += o;
      }
      for(int a = 0; a < 2; a++) {
        float *b = n->ap[a];
        double o = b[n->ai[a]];
        b[n->ai[a]] = (float)(y + o * 0.5);
        y = o - y;
        if(++n->ai[a] >= n->alen[a]) n->ai[a] = 0;
      }
      n->out[k] = (float)y;
    }
    break;
  }
  }
  return n->out;
}

// ¿Sigue sonando o puede sonar? Una fuente, hasta su stop; los demás, mientras tengan entradas.
static int
active(node_t *n) {
  if(n->type == N_OSC || n->type == N_BUFSRC) return n->start >= 0 && (n->stop < 0 || n->stop > now_s);
  return n->nin > 0 || n->p[0].nin > 0 || !n->ever_input;
}

// ---------------- jugadores 2-4: su salida, al altavoz de su mando ----------------
#define PGRAIN 256
#define PRING 8192   // muestras (mono), potencia de dos
static struct { int16_t ring[PRING]; atomic_uint r, w; atomic_int port; int thread; } pads[NDEST];
static atomic_int route;   // 1: cada jugador por su mando (la tele en silencio); 0: sólo el 1, en la tele (ps.au_route)
#ifdef PS5_TITLE
int sceKernelUsleep(uint32_t us);
int sceAudioOutOpen(int32_t user, int32_t type, int32_t index, uint32_t grain, uint32_t rate, uint32_t format);
int sceAudioOutOutput(int32_t port, const void *samples);
int sceAudioOutSetVolume(int32_t port, int32_t channels, int32_t *vol);
static void*
pad_main(void *arg) {
  const int d = (int)(intptr_t)arg;
  int16_t g[PGRAIN] __attribute__((aligned(64)));
  for(;;) {
    const int port = atomic_load(&pads[d].port);
    const unsigned r = atomic_load(&pads[d].r), avail = atomic_load(&pads[d].w) - r;
    for(unsigned i = 0; i < PGRAIN; i++) g[i] = i < avail ? pads[d].ring[(r + i) % PRING] : 0;   // (si falta: silencio)
    atomic_store(&pads[d].r, r + (avail < PGRAIN ? avail : PGRAIN));
    if(port < 0 || sceAudioOutOutput(port, g) < 0) sceKernelUsleep(5000);   // marca el ritmo: un bloque
  }
  return NULL;
}
#endif

static void
free_node(int id) {
  node_t *n = &nodes[id];
  for(int j = 0; j < nlive; j++) if(live[j] == id) { live[j] = live[--nlive]; break; }
  for(int j = 0; j < nlive; j++) {
    node_t *o = &nodes[live[j]];
    list_del(o->in, &o->nin, id);
    for(int p = 0; p < 3; p++) list_del(o->p[p].in, &o->p[p].nin, id);
  }
  free(n->in);
  for(int p = 0; p < 3; p++) free(n->p[p].in);
  free(n->buf);
  for(int c = 0; c < 4; c++) free(n->comb[c]);
  for(int a = 0; a < 2; a++) free(n->ap[a]);
  memset(n, 0, sizeof *n);
}

// Una vez por bloque: los nodos que el JS soltó y ya no suenan, fuera.
static void
collect(void) {
  int again = 1;
  while(again) {
    again = 0;
    for(int j = nlive - 1; j >= 0; j--) {
      int i = live[j];
      node_t *n = &nodes[i];
      if(i >= NDEST && !n->js_alive && (!active(n) || (n->type != N_OSC && n->type != N_BUFSRC && !n->ever_input))) {
        free_node(i);
        again = 1;   // al quitarlo, otros pueden quedarse sin entradas
        if(j > nlive) j = nlive;
      }
    }
  }
}

static void SDLCALL
mix(void *user, Uint8 *stream, int len) {
  float *out = (float*)stream;
  int frames = len / (int)(sizeof(float) * 2);
  Uint64 t0 = SDL_GetPerformanceCounter();
  double ms;
  for(int f = 0; f < frames; f += BLOCK) {
    int n = frames - f < BLOCK ? frames - f : BLOCK;
    for(int d = 0; d < NDEST; d++) {   // la tele (0) y el mando de cada jugador 2-4 que tenga salida
      const int pads_on = atomic_load(&route);
      if(d && (!pads_on || atomic_load(&pads[d].port) < 0 || !nodes[d].used)) continue;
      const float *b = render(d, 0);
      unsigned w = atomic_load(&pads[d].w);
      for(int k = 0; k < n; k++) {
        // Limitador: transparente hasta ±0,95 y suave por encima (antes redondeaba ya a media escala: el bajo se deformaba).
        float v = b[k], a = fabsf(v);
        if(a > 0.95f) v = copysignf(0.95f + 0.05f * tanhf((a - 0.95f) / 0.05f), v);
        // (el 1 con su mando sonando —cooperativo local—: la tele en silencio, si no se oía doble)
        const int p0 = pads_on && atomic_load(&pads[0].port) >= 0;   // (el 1 por su mando)
        if(!d) out[(f + k) * 2] = out[(f + k) * 2 + 1] = p0 ? 0 : v;
        if((d || p0) && w - atomic_load(&pads[d].r) < PRING - 1) pads[d].ring[w++ % PRING] = (int16_t)(v * 32767);   // (lleno: se tira)
      }
      atomic_store(&pads[d].w, w);
    }
    block_no++;
    now_s = (double)block_no * BLOCK / RATE;
    if(!(block_no & 7)) collect();
  }
  ms = (SDL_GetPerformanceCounter() - t0) * 1000.0 / SDL_GetPerformanceFrequency();
  if(ms > mix_ms_max) mix_ms_max = ms;
}

// ---------------- API para el JS (ps.au_*) ----------------

static double
num(JSContext *ctx, JSValueConst v) { double d = 0; JS_ToFloat64(ctx, &d, v); return d; }

static int
id_of(JSContext *ctx, JSValueConst v) {
  intptr_t p = (intptr_t)JS_GetOpaque(v, handle_class);
  return p > 0 && p <= MAX_NODES && nodes[p - 1].used ? (int)p - 1 : -1;
}

static void
handle_finalizer(JSRuntime *rt, JSValue v) {
  intptr_t p = (intptr_t)JS_GetOpaque(v, handle_class);
  if(p <= 0 || p > MAX_NODES) return;
  SDL_LockAudioDevice(dev);
  if(nodes[p - 1].used && p - 1 >= NDEST) nodes[p - 1].js_alive = 0;   // las salidas (0-3) no se sueltan nunca
  SDL_UnlockAudioDevice(dev);
}

// au_node(tipo) -> asa (un objeto: cuando el JS lo suelta, el nodo puede liberarse)
static JSValue
au_node(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int type = (int)num(ctx, argv[0]), id = -1;
  JSValue h;
  SDL_LockAudioDevice(dev);
  const int me = (int)(intptr_t)JS_GetContextOpaque(ctx);   // (su salida: la de su jugador)
  if(type == N_DEST) id = me >= 0 && me < NDEST ? me : 0;
  else for(int i = NDEST; i < MAX_NODES; i++) if(!nodes[i].used) { id = i; break; }
  if(id >= 0) {
    if(nodes[id].used) for(int j = 0; j < nlive; j++) if(live[j] == id) { live[j] = live[--nlive]; break; }   // (otra vez)
    node_t *n = &nodes[id];
    memset(n, 0, sizeof *n);
    n->used = 1; n->js_alive = 1; n->type = type; n->start = -1; n->stop = -1;
    live[nlive++] = id;
    switch(type) {
    case N_GAIN: param_init(&n->p[0], 1); break;
    case N_OSC: param_init(&n->p[0], 440); param_init(&n->p[1], 0); break;
    case N_BUFSRC: param_init(&n->p[0], 1); break;
    case N_BIQUAD: param_init(&n->p[0], 350); param_init(&n->p[1], 1); break;
    case N_COMP: param_init(&n->p[0], -24); param_init(&n->p[1], 12); break;
    case N_REVERB: {
      static const int CL[4] = { 1557, 1617, 1491, 1422 }, AL[2] = { 556, 441 };   // de Freeverb, a 44,1 kHz
      for(int c = 0; c < 4; c++) { n->clen[c] = CL[c] * RATE / 44100; n->comb[c] = calloc(n->clen[c], sizeof(float)); }
      for(int a = 0; a < 2; a++) { n->alen[a] = AL[a] * RATE / 44100; n->ap[a] = calloc(n->alen[a], sizeof(float)); }
      break;
    }
    }
  }
  SDL_UnlockAudioDevice(dev);
  if(id < 0) return JS_ThrowRangeError(ctx, "demasiados nodos de audio");
  h = JS_NewObjectClass(ctx, handle_class);
  JS_SetOpaque(h, (void*)(intptr_t)(id + 1));
  return h;
}

// au_connect(asa, destino, parámetro|-1): a la entrada de audio o a un parámetro del destino.
static JSValue
au_connect(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int a = id_of(ctx, argv[0]), b = id_of(ctx, argv[1]), p = argc > 2 ? (int)num(ctx, argv[2]) : -1;
  if(a < 0 || b < 0 || a == b) return JS_UNDEFINED;
  SDL_LockAudioDevice(dev);
  if(p >= 0 && p < 3) list_add(&nodes[b].p[p].in, &nodes[b].p[p].nin, &nodes[b].p[p].cin, a);
  else list_add(&nodes[b].in, &nodes[b].nin, &nodes[b].cin, a);
  nodes[b].ever_input = 1;
  SDL_UnlockAudioDevice(dev);
  return JS_UNDEFINED;
}

// au_disconnect(asa): fuera de todas las entradas
static JSValue
au_disconnect(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int a = id_of(ctx, argv[0]);
  if(a < 0) return JS_UNDEFINED;
  SDL_LockAudioDevice(dev);
  for(int i = 0; i < MAX_NODES; i++) {
    if(!nodes[i].used) continue;
    list_del(nodes[i].in, &nodes[i].nin, a);
    for(int p = 0; p < 3; p++) list_del(nodes[i].p[p].in, &nodes[i].p[p].nin, a);
  }
  SDL_UnlockAudioDevice(dev);
  return JS_UNDEFINED;
}

// au_param(asa, parámetro, tipo, t, v, tc): 0 setValueAtTime · 1 linear · 2 exponential · 3 setTarget · 4 .value = v · 5 cancelar
static JSValue
au_param(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int a = id_of(ctx, argv[0]), p = (int)num(ctx, argv[1]), type = (int)num(ctx, argv[2]);
  double t = num(ctx, argv[3]), v = num(ctx, argv[4]), tc = argc > 5 ? num(ctx, argv[5]) : 0;
  if(a < 0 || p < 0 || p > 2 || !(v == v && fabs(v) < 1e30)) return JS_UNDEFINED;   // NaN o infinito: se ignora
  SDL_LockAudioDevice(dev);
  {
    param_t *pp = &nodes[a].p[p];
    if(type == 4) { if(!pp->nev) pp->value = v; else param_add(pp, E_SET, now_s, v, 0); }
    else if(type == 5) pp->nev = 0;
    else param_add(pp, type == 1 ? E_LINEAR : type == 2 ? E_EXP : type == 3 ? E_TARGET : E_SET, t, v, tc);
  }
  SDL_UnlockAudioDevice(dev);
  return JS_UNDEFINED;
}

// au_value(asa, parámetro) -> el valor ahora
static JSValue
au_value(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int a = id_of(ctx, argv[0]), p = (int)num(ctx, argv[1]);
  double v = 0;
  if(a < 0 || p < 0 || p > 2) return JS_NewFloat64(ctx, 0);
  SDL_LockAudioDevice(dev);
  v = param_at(&nodes[a].p[p], now_s);
  SDL_UnlockAudioDevice(dev);
  return JS_NewFloat64(ctx, v);
}

// au_set(asa, campo, valor): 0 forma de onda · 1 tipo de filtro · 2 start(t) · 3 stop(t) · 4 posición inicial (s)
static JSValue
au_set(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int a = id_of(ctx, argv[0]), field = (int)num(ctx, argv[1]);
  double v = num(ctx, argv[2]);
  if(a < 0) return JS_UNDEFINED;
  SDL_LockAudioDevice(dev);
  switch(field) {
  case 0: nodes[a].wave = (int)v; break;
  case 1: nodes[a].ftype = (int)v; break;
  case 2: nodes[a].start = v > now_s ? v : now_s; break;
  case 3: nodes[a].stop = v > now_s ? v : now_s; break;
  case 4: nodes[a].pos = v * RATE; break;
  }
  SDL_UnlockAudioDevice(dev);
  return JS_UNDEFINED;
}

// au_buffer(asa, Float32Array): el búfer de una fuente (se copia)
static JSValue
au_buffer(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  int a = id_of(ctx, argv[0]);
  size_t off, len, bpe, size;
  JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[1], &off, &len, &bpe);
  const Uint8 *src;
  float *copy;
  if(JS_IsException(ab)) return ab;
  src = JS_GetArrayBuffer(ctx, &size, ab);
  if(a < 0 || !src || bpe != 4) { JS_FreeValue(ctx, ab); return JS_UNDEFINED; }
  copy = malloc(len);
  if(copy) memcpy(copy, src + off, len);
  JS_FreeValue(ctx, ab);
  SDL_LockAudioDevice(dev);
  free(nodes[a].buf);
  nodes[a].buf = copy;
  nodes[a].buflen = copy ? (int)(len / 4) : 0;
  SDL_UnlockAudioDevice(dev);
  return JS_UNDEFINED;
}

// au_route(1|0): con varios jugadores, cada uno por su mando (la tele en silencio) o sólo el 1, por la tele.
static JSValue
au_route(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  if(argc) atomic_store(&route, num(ctx, argv[0]) ? 1 : 0);
  return JS_UNDEFINED;
}

static JSValue
au_time(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  double t;
  SDL_LockAudioDevice(dev);
  t = now_s;
  SDL_UnlockAudioDevice(dev);
  return JS_NewFloat64(ctx, t);
}

// au_stats() -> [nodos vivos, la mezcla más lenta (ms) desde la última consulta, el margen que hay (ms)]
static JSValue
au_stats(JSContext *ctx, JSValueConst this, int argc, JSValueConst *argv) {
  JSValue a = JS_NewArray(ctx);
  SDL_LockAudioDevice(dev);
  JS_SetPropertyUint32(ctx, a, 0, JS_NewInt32(ctx, nlive));
  JS_SetPropertyUint32(ctx, a, 1, JS_NewFloat64(ctx, mix_ms_max));
  mix_ms_max = 0;
  SDL_UnlockAudioDevice(dev);
  JS_SetPropertyUint32(ctx, a, 2, JS_NewFloat64(ctx, 1024.0 * 1000 / RATE));
  return a;
}

int
audio_init(JSContext *ctx, JSValue ps) {
  SDL_AudioSpec want = { 0 }, have;
  JSClassDef def = { "AudioHandle", .finalizer = handle_finalizer };
  if(!handle_class) JS_NewClassID(&handle_class);   // (uno para todos; la clase, en cada runtime)
  if(!JS_IsRegisteredClass(JS_GetRuntime(ctx), handle_class)) JS_NewClass(JS_GetRuntime(ctx), handle_class, &def);
#define FN(name, n) JS_SetPropertyStr(ctx, ps, #name, JS_NewCFunction(ctx, name, #name, n))
  FN(au_node, 1); FN(au_connect, 3); FN(au_disconnect, 1); FN(au_param, 6); FN(au_value, 2);
  FN(au_set, 3); FN(au_buffer, 2); FN(au_time, 0); FN(au_stats, 0); FN(au_route, 1);
#undef FN
  // Al recargar el JS (otro contexto) el dispositivo sigue abierto: sólo se vuelven a poner las funciones.
  static int rate;
  if(!dev) {
    for(int d = 0; d < NDEST; d++) atomic_store(&pads[d].port, -1);
    want.freq = RATE; want.format = AUDIO_F32SYS; want.channels = 2; want.samples = 1024; want.callback = mix;
    dev = SDL_OpenAudioDevice(NULL, 0, &want, &have, 0);
    if(!dev) return -1;
    rate = have.freq;
    SDL_PauseAudioDevice(dev, 0);
  }
  JS_SetPropertyStr(ctx, ps, "AUDIO_RATE", JS_NewInt32(ctx, rate));
  return 0;
}

// Jugadores 2-4 (main.c, cooperativo local): sus ps.au_* (en el grafo de todos, con su salida) y el altavoz de su mando,
// el PADSPK de su usuario (mono). Se abre a volumen 0: el nuestro, a 0 dB; el del mando (ajustes de la PS5) sigue contando.
int
audio_pad(int me, int32_t user) {
#ifdef PS5_TITLE
  if(me < 0 || me >= NDEST) return -1;
  if(atomic_load(&pads[me].port) < 0) {
    const int port = sceAudioOutOpen(user, 4, 0, PGRAIN, RATE, 0);
    int32_t vol[8] = { 32768, 32768, 32768, 32768, 32768, 32768, 32768, 32768 };
    if(port >= 0) sceAudioOutSetVolume(port, 1, vol);
    atomic_store(&pads[me].r, atomic_load(&pads[me].w));
    atomic_store(&pads[me].port, port >= 0 ? port : -1);
    if(port >= 0 && !pads[me].thread) { pthread_t t; pads[me].thread = pthread_create(&t, NULL, pad_main, (void*)(intptr_t)me) == 0; }
    return port >= 0 ? 0 : port;
  }
#else
  (void)me; (void)user;
#endif
  return 0;
}
int
audio_player(JSContext *ctx, JSValue ps, int me, int32_t user) {
  if(!dev || me <= 0 || me >= NDEST) return -1;
  audio_init(ctx, ps);
  return audio_pad(me, user);
}
