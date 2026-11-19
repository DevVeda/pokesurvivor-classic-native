/* gpu.c — la pantalla del juego por OpenGL 3.3 (o ES 3.0): lo que canvas.c dibuja en ella se junta en lotes de
 * cuadriláteros con textura y va a un framebuffer propio (como un <canvas>, lo pintado se queda entre fotogramas).
 * gpu_present lo copia a la ventana. Ver gpu.h y SWITCH.md (fase 2).
 *
 * Las texturas se suben tal cual de PlutoVG (ARGB en memoria: B, G, R, A) como RGBA y el sombreador las da la vuelta
 * (.bgra): sin GL_BGRA, que ES no tiene. Mezcla premultiplicada, muestreo al píxel (pixel art, como el blit de canvas.c).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <stdio.h>
#include <string.h>
#include <SDL2/SDL.h>
#include <SDL2/SDL_opengl.h>
#include "gpu.h"

int gpu_on;

// Las funciones de GL, por SDL_GL_GetProcAddress (sin enlazar con GL ni pedir cargadores aparte).
#define GLFNS(X) \
  X(void, GenTextures, (GLsizei, GLuint*)) X(void, DeleteTextures, (GLsizei, const GLuint*)) \
  X(void, BindTexture, (GLenum, GLuint)) X(void, TexParameteri, (GLenum, GLenum, GLint)) \
  X(void, TexImage2D, (GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, const void*)) \
  X(void, TexSubImage2D, (GLenum, GLint, GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, const void*)) \
  X(void, PixelStorei, (GLenum, GLint)) X(void, ActiveTexture, (GLenum)) \
  X(void, GenFramebuffers, (GLsizei, GLuint*)) X(void, BindFramebuffer, (GLenum, GLuint)) \
  X(void, FramebufferTexture2D, (GLenum, GLenum, GLenum, GLuint, GLint)) \
  X(void, BlitFramebuffer, (GLint, GLint, GLint, GLint, GLint, GLint, GLint, GLint, GLbitfield, GLenum)) \
  X(void, Viewport, (GLint, GLint, GLsizei, GLsizei)) X(void, ClearColor, (GLfloat, GLfloat, GLfloat, GLfloat)) \
  X(void, Clear, (GLbitfield)) X(void, Enable, (GLenum)) X(void, Disable, (GLenum)) X(void, BlendFunc, (GLenum, GLenum)) \
  X(GLuint, CreateShader, (GLenum)) X(void, ShaderSource, (GLuint, GLsizei, const GLchar* const*, const GLint*)) \
  X(void, CompileShader, (GLuint)) X(void, GetShaderiv, (GLuint, GLenum, GLint*)) \
  X(void, GetShaderInfoLog, (GLuint, GLsizei, GLsizei*, GLchar*)) X(GLuint, CreateProgram, (void)) \
  X(void, AttachShader, (GLuint, GLuint)) X(void, BindAttribLocation, (GLuint, GLuint, const GLchar*)) \
  X(void, LinkProgram, (GLuint)) X(void, GetProgramiv, (GLuint, GLenum, GLint*)) X(void, UseProgram, (GLuint)) \
  X(GLint, GetUniformLocation, (GLuint, const GLchar*)) X(void, Uniform2f, (GLint, GLfloat, GLfloat)) \
  X(void, Uniform1i, (GLint, GLint)) X(void, GenVertexArrays, (GLsizei, GLuint*)) X(void, BindVertexArray, (GLuint)) \
  X(void, GenBuffers, (GLsizei, GLuint*)) X(void, BindBuffer, (GLenum, GLuint)) \
  X(void, BufferData, (GLenum, GLsizeiptr, const void*, GLenum)) \
  X(void, VertexAttribPointer, (GLuint, GLint, GLenum, GLboolean, GLsizei, const void*)) \
  X(void, EnableVertexAttribArray, (GLuint)) X(void, DrawArrays, (GLenum, GLint, GLsizei)) \
  X(void, ReadPixels, (GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void*)) X(void, Finish, (void)) \
  X(void, GenRenderbuffers, (GLsizei, GLuint*)) X(void, BindRenderbuffer, (GLenum, GLuint)) \
  X(void, RenderbufferStorage, (GLenum, GLenum, GLsizei, GLsizei)) \
  X(void, FramebufferRenderbuffer, (GLenum, GLenum, GLenum, GLuint)) X(void, StencilFunc, (GLenum, GLint, GLuint)) \
  X(void, StencilOp, (GLenum, GLenum, GLenum)) X(void, StencilMask, (GLuint)) \
  X(void, ColorMask, (GLboolean, GLboolean, GLboolean, GLboolean)) X(void, ClearStencil, (GLint))
#define DECL(ret, name, args) ret (APIENTRY *name) args;
static struct { GLFNS(DECL) } gl;
#undef DECL

static SDL_GLContext glc;
static int W, H;                 // la pantalla del juego
static GLuint fbo, fbo_tex, prog, vao, vbo, white, u_size, stencil;
static int clip_on;              // gpu_clip: el recorte (stencil) de la pantalla está puesto

// ---------------- lotes ----------------
#define MAXV (6 * 8192)
static float vb[MAXV * 8];       // x, y, u, v, r, g, b, a
static int nv, cur_op = -1;
static GLuint cur_tex;

// Los modos de canvas.js (OPS de canvas.c) en mezcla premultiplicada. Los que en el navegador borran fuera de la
// figura (source-in, source-out, destination-in, destination-atop) aquí sólo actúan dentro de su recuadro.
static const GLenum BLEND[][2] = {
  { GL_ONE, GL_ONE_MINUS_SRC_ALPHA },            // source-over
  { GL_DST_ALPHA, GL_ZERO },                     // source-in
  { GL_ONE_MINUS_DST_ALPHA, GL_ZERO },           // source-out
  { GL_DST_ALPHA, GL_ONE_MINUS_SRC_ALPHA },      // source-atop
  { GL_ONE_MINUS_DST_ALPHA, GL_ONE },            // destination-over
  { GL_ZERO, GL_SRC_ALPHA },                     // destination-in
  { GL_ZERO, GL_ONE_MINUS_SRC_ALPHA },           // destination-out
  { GL_ONE_MINUS_DST_ALPHA, GL_SRC_ALPHA },      // destination-atop
  { GL_ONE_MINUS_DST_ALPHA, GL_ONE_MINUS_SRC_ALPHA },   // xor
  { GL_ONE, GL_ZERO },                           // copy
  { GL_ZERO, GL_ZERO },                          // clear
};

static void
flush(void) {
  if(!nv) return;
  gl.BindTexture(GL_TEXTURE_2D, cur_tex);
  gl.BlendFunc(BLEND[cur_op][0], BLEND[cur_op][1]);
  gl.BufferData(GL_ARRAY_BUFFER, (GLsizeiptr)nv * 8 * sizeof(float), vb, GL_STREAM_DRAW);
  gl.DrawArrays(GL_TRIANGLES, 0, nv);
  nv = 0;
}

void
gpu_quad(unsigned tex, int tw, int th, int op, const float *xy, float sx, float sy, float sw, float sh,
         float r, float g, float b, float a) {
  const float u0 = sx / tw, v0 = sy / th, u1 = (sx + sw) / tw, v1 = (sy + sh) / th;
  const float uv[8] = { u0, v0, u1, v0, u1, v1, u0, v1 };
  static const int idx[6] = { 0, 1, 2, 0, 2, 3 };
  if(!tex) tex = white;
  if(op < 0 || op > 10) op = 0;
  if(tex != cur_tex || op != cur_op || nv + 6 > MAXV) { flush(); cur_tex = tex; cur_op = op; }
  for(int i = 0; i < 6; i++) {
    float *v = vb + (size_t)nv++ * 8;
    const int k = idx[i];
    v[0] = xy[k * 2]; v[1] = xy[k * 2 + 1]; v[2] = uv[k * 2]; v[3] = uv[k * 2 + 1];
    v[4] = r; v[5] = g; v[6] = b; v[7] = a;
  }
}

// ---------------- recorte (ctx.clip) ----------------
// La figura del recorte va al stencil: un abanico por polígono que invierte sus bits (par-impar: vale aunque no sean
// convexos, y varios polígonos se suman), y luego sólo se pinta donde el stencil quedó a 0xff. Lo que pinta PlutoVG en
// el borrador se sube con cuadriláteros: también queda recortado. Con la pantalla partida del cooperativo (una zona por
// cámara, core.js viewBegin), sin esto cada sprite recortado iba por la CPU y el borrador (3 fps en Android).
void
gpu_clip(const float *xy, const int *count, int npoly) {
  flush();
  gl.StencilMask(0xff);
  gl.ClearStencil(0);
  gl.Clear(GL_STENCIL_BUFFER_BIT);
  gl.Enable(GL_STENCIL_TEST);
  gl.StencilFunc(GL_ALWAYS, 0, 0xff);
  gl.StencilOp(GL_KEEP, GL_KEEP, GL_INVERT);
  gl.ColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE);
  cur_tex = white; cur_op = 0;
  for(int p = 0; p < npoly; p++, xy += count[p - 1] * 2)
    for(int i = 1; i + 1 < count[p]; i++) {
      const float *t[3] = { xy, xy + i * 2, xy + i * 2 + 2 };
      if(nv + 3 > MAXV) flush();
      for(int k = 0; k < 3; k++) {
        float *v = vb + (size_t)nv++ * 8;
        v[0] = t[k][0]; v[1] = t[k][1]; v[2] = v[3] = 0; v[4] = v[5] = v[6] = v[7] = 1;
      }
    }
  flush();
  gl.ColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
  gl.StencilFunc(GL_EQUAL, 0xff, 0xff);
  gl.StencilOp(GL_KEEP, GL_KEEP, GL_KEEP);
  clip_on = 1;
}

void
gpu_clip_off(void) {
  if(!clip_on) return;
  flush();
  gl.Disable(GL_STENCIL_TEST);
  clip_on = 0;
}

// ---------------- texturas ----------------
static GLuint dead[4096];
static int ndead;

static void
params(void) {
  gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  gl.TexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
}

unsigned
gpu_upload(unsigned tex, const Uint32 *px, int w, int h, int stride) {
  GLuint t = tex;
  if(t == cur_tex) flush();   // (un lote pendiente la usa con lo de antes)
  if(!t) { gl.GenTextures(1, &t); gl.BindTexture(GL_TEXTURE_2D, t); params(); }
  else gl.BindTexture(GL_TEXTURE_2D, t);
  gl.PixelStorei(GL_UNPACK_ROW_LENGTH, stride);
  gl.TexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, px);
  gl.PixelStorei(GL_UNPACK_ROW_LENGTH, 0);
  return t;
}

void
gpu_delete(unsigned tex) {
  if(!tex) return;
  if(ndead == (int)(sizeof dead / sizeof *dead)) { flush(); gl.DeleteTextures(ndead, dead); ndead = 0; }
  dead[ndead++] = tex;
}

// Imágenes que no cambian (textos y degradados ya pintados de canvas.c): tabla por dirección.
// ponytail: direccionamiento abierto; gpu_forget deja una marca (clave 1) que no se reutiliza; 8192 entradas de sobra para
// las 2048 + 8 cachés de canvas.c. Si se llena, se vacía entera.
#define IMG_N 8192
static struct { const void *key; GLuint tex; } img[IMG_N];
static int img_used;

unsigned
gpu_image(const void *key, const Uint32 *px, int w, int h, int stride) {
  size_t i = ((uintptr_t)key >> 4) % IMG_N;
  for(int n = 0; n < IMG_N; n++, i = (i + 1) % IMG_N) {
    if(img[i].key == key) return img[i].tex;
    if(!img[i].key && !img[i].tex) break;
  }
  if(img_used > IMG_N * 3 / 4) {
    for(int k = 0; k < IMG_N; k++) gpu_delete(img[k].tex);
    memset(img, 0, sizeof img);
    img_used = 0;
    i = ((uintptr_t)key >> 4) % IMG_N;
  }
  while(img[i].key || img[i].tex) i = (i + 1) % IMG_N;
  img[i].key = key;
  img[i].tex = gpu_upload(0, px, w, h, stride);
  img_used++;
  return img[i].tex;
}

void
gpu_forget(const void *key) {
  size_t i = ((uintptr_t)key >> 4) % IMG_N;
  for(int n = 0; n < IMG_N; n++, i = (i + 1) % IMG_N) {
    if(img[i].key == key) { gpu_delete(img[i].tex); img[i].key = (const void*)1; img[i].tex = 0; return; }   // (marca de borrado: las búsquedas siguen)
    if(!img[i].key && !img[i].tex) return;
  }
}

// ---------------- el borrador ----------------
// Lo que pinta PlutoVG en la pantalla (caminos, texto nuevo, recortes) se sube a un atlas por estantes y se pinta
// como un cuadrilátero. Se vacía en cada fotograma (o antes, si se llena).
#define ATLAS 2048
static GLuint atlas;
static int ax, ay, arow;

void
gpu_scratch(const Uint32 *px, int stride, int x, int y, int w, int h, int op) {
  float xy[8];
  if(w <= 0 || h <= 0 || w > ATLAS || h > ATLAS) return;
  if(ax + w > ATLAS) { ax = 0; ay += arow; arow = 0; }
  if(ay + h > ATLAS) { flush(); ax = ay = arow = 0; }
  if(cur_tex == atlas) flush();
  gl.BindTexture(GL_TEXTURE_2D, atlas);
  gl.PixelStorei(GL_UNPACK_ROW_LENGTH, stride);
  gl.TexSubImage2D(GL_TEXTURE_2D, 0, ax, ay, w, h, GL_RGBA, GL_UNSIGNED_BYTE, px);
  gl.PixelStorei(GL_UNPACK_ROW_LENGTH, 0);
  xy[0] = xy[6] = (float)x; xy[2] = xy[4] = (float)(x + w);
  xy[1] = xy[3] = (float)y; xy[5] = xy[7] = (float)(y + h);
  gpu_quad(atlas, ATLAS, ATLAS, op, xy, (float)ax, (float)ay, (float)w, (float)h, 1, 1, 1, 1);
  ax += w;
  if(h > arow) arow = h;
}

void
gpu_read(Uint32 *dst, int w, int h) {
  flush();
  gl.ReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, dst);
  // De abajo arriba y en RGBA: a filas de arriba abajo y ARGB (B, G, R, A en memoria).
  for(int y = 0; y < h / 2; y++)
    for(int x = 0; x < w; x++) { Uint32 t = dst[(size_t)y * w + x]; dst[(size_t)y * w + x] = dst[(size_t)(h - 1 - y) * w + x]; dst[(size_t)(h - 1 - y) * w + x] = t; }
  for(size_t i = 0; i < (size_t)w * h; i++) {
    Uint32 v = dst[i];   // bytes R, G, B, A → B, G, R, A
    dst[i] = (v & 0xff00ff00) | (v & 0xff) << 16 | (v >> 16 & 0xff);
  }
}

// ---------------- arranque y presentar ----------------
static GLuint
shader(GLenum type, const char *head, const char *src) {
  const char *s[2] = { head, src };
  GLuint sh = gl.CreateShader(type);
  GLint ok = 0;
  char log[512];
  gl.ShaderSource(sh, 2, s, NULL);
  gl.CompileShader(sh);
  gl.GetShaderiv(sh, GL_COMPILE_STATUS, &ok);
  if(!ok) { gl.GetShaderInfoLog(sh, sizeof log, NULL, log); fprintf(stderr, "[gpu] sombreador: %s\n", log); }
  return sh;
}

int
gpu_open(SDL_Window *win, int w, int h) {
  static const Uint32 one = 0xffffffff;
  int es = 0, ok = 0;
  const char *head;
  W = w; H = h;
  // OpenGL 3.3 (escritorio, y el de mesa en Switch); si no, ES 3.0.
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
  if(!(glc = SDL_GL_CreateContext(win))) {
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
    if(!(glc = SDL_GL_CreateContext(win))) { fprintf(stderr, "[gpu] sin contexto GL: %s\n", SDL_GetError()); return -1; }
    es = 1;
  }
#define LOAD(ret, name, args) if(!(*(void**)&gl.name = SDL_GL_GetProcAddress("gl" #name))) { fprintf(stderr, "[gpu] falta gl%s\n", #name); return -1; }
  GLFNS(LOAD)
#undef LOAD
  SDL_GL_SetSwapInterval(1);
  head = es ? "#version 300 es\nprecision mediump float;\n" : "#version 330 core\n";
  prog = gl.CreateProgram();
  gl.AttachShader(prog, shader(GL_VERTEX_SHADER, head,
    "uniform vec2 size; in vec2 p; in vec2 t; in vec4 c; out vec2 vt; out vec4 vc;\n"
    "void main() { vt = t; vc = c; gl_Position = vec4(p.x / size.x * 2.0 - 1.0, 1.0 - p.y / size.y * 2.0, 0.0, 1.0); }\n"));
  gl.AttachShader(prog, shader(GL_FRAGMENT_SHADER, head,
    "uniform sampler2D tx; in vec2 vt; in vec4 vc; out vec4 o;\n"
    // (r < 0: silueta, sólo la transparencia de la textura, en blanco: el destello de los golpes, gpu.h)
    "void main() { vec4 x = texture(tx, vt).bgra; if(vc.r < 0.0) x = vec4(x.a); o = x * abs(vc); }\n"));
  gl.BindAttribLocation(prog, 0, "p"); gl.BindAttribLocation(prog, 1, "t"); gl.BindAttribLocation(prog, 2, "c");
  gl.LinkProgram(prog);
  gl.GetProgramiv(prog, GL_LINK_STATUS, &ok);
  if(!ok) { fprintf(stderr, "[gpu] el programa no enlaza\n"); return -1; }
  gl.UseProgram(prog);
  u_size = gl.GetUniformLocation(prog, "size");
  gl.Uniform2f(u_size, (float)w, (float)h);
  gl.Uniform1i(gl.GetUniformLocation(prog, "tx"), 0);
  gl.GenVertexArrays(1, &vao); gl.BindVertexArray(vao);
  gl.GenBuffers(1, &vbo); gl.BindBuffer(GL_ARRAY_BUFFER, vbo);
  gl.VertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 32, (void*)0);
  gl.VertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 32, (void*)8);
  gl.VertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, 32, (void*)16);
  for(int i = 0; i < 3; i++) gl.EnableVertexAttribArray(i);
  gl.ActiveTexture(GL_TEXTURE0);
  white = gpu_upload(0, &one, 1, 1, 1);
  atlas = gpu_upload(0, NULL, ATLAS, ATLAS, ATLAS);
  // La pantalla: una textura con su framebuffer, transparente al empezar (como un lienzo nuevo).
  fbo_tex = gpu_upload(0, NULL, w, h, w);
  gl.GenFramebuffers(1, &fbo);
  gl.BindFramebuffer(GL_FRAMEBUFFER, fbo);
  gl.FramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, fbo_tex, 0);
  gl.GenRenderbuffers(1, &stencil);   // (el recorte: gpu_clip)
  gl.BindRenderbuffer(GL_RENDERBUFFER, stencil);
  gl.RenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, w, h);   // (el stencil solo no vale en todos los GL 3.3)
  gl.FramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, stencil);
  gl.Viewport(0, 0, w, h);
  gl.ClearColor(0, 0, 0, 0);
  gl.Clear(GL_COLOR_BUFFER_BIT);
  gl.Enable(GL_BLEND);
  fprintf(stderr, "[gpu] %s, pantalla %dx%d\n", es ? "OpenGL ES 3.0" : "OpenGL 3.3", w, h);
  gpu_on = 1;
  return 0;
}

void gpu_prof(void (*say)(const char *fmt, ...), unsigned long frames) { (void)say; (void)frames; }   // (sólo gpu_vk.c)

void
gpu_window_to_game(SDL_Window *win, int *x, int *y) {
  int ww, wh, vw, vh;
  SDL_GetWindowSize(win, &ww, &wh);
  vw = ww; vh = ww * H / W;   // (las mismas bandas que gpu_present)
  if(vh > wh) { vh = wh; vw = wh * W / H; }
  if(vw <= 0 || vh <= 0) return;
  *x = (*x - (ww - vw) / 2) * W / vw;
  *y = (*y - (wh - vh) / 2) * H / vh;
}

void
gpu_present(SDL_Window *win, double *copy_ms, double *wait_ms) {
  const double f = 1000.0 / SDL_GetPerformanceFrequency();
  Uint64 t0 = SDL_GetPerformanceCounter(), t1;
  int dw, dh, vw, vh;
  flush();
  // A la ventana, con bandas si no es 16:9.
  SDL_GL_GetDrawableSize(win, &dw, &dh);
  vw = dw; vh = dw * H / W;
  if(vh > dh) { vh = dh; vw = dh * W / H; }
  if(clip_on) gl.Disable(GL_STENCIL_TEST);   // (la ventana no tiene el recorte de la pantalla)
  gl.BindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
  gl.ClearColor(0, 0, 0, 1);
  gl.Clear(GL_COLOR_BUFFER_BIT);
  gl.BlitFramebuffer(0, 0, W, H, (dw - vw) / 2, (dh - vh) / 2, (dw - vw) / 2 + vw, (dh - vh) / 2 + vh, GL_COLOR_BUFFER_BIT, GL_LINEAR);
  t1 = SDL_GetPerformanceCounter();
  SDL_GL_SwapWindow(win);   // espera al vsync
  gl.BindFramebuffer(GL_FRAMEBUFFER, fbo);
  gl.Viewport(0, 0, W, H);
  if(clip_on) gl.Enable(GL_STENCIL_TEST);
  if(ndead) { gl.DeleteTextures(ndead, dead); ndead = 0; }
  ax = ay = arow = 0;
  cur_tex = 0; cur_op = -1;
  *copy_ms = (t1 - t0) * f;
  *wait_ms = (SDL_GetPerformanceCounter() - t1) * f;
}
