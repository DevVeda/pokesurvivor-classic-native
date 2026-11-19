/* gpu_vk.c — la pantalla del juego por Vulkan (RADV enlazado en el título de PS5): la misma API que gpu.c (gpu.h), que
 * es OpenGL en escritorio, Switch y Android. canvas.c no cambia: le manda los mismos cuadriláteros y el borrador.
 *
 * Cómo emula lo inmediato de GL (cada llamada ve lo anterior):
 * - Cada fotograma graba dos command buffers, que van juntos y en orden: «pre» (copias que no chocan con nada de este
 *   fotograma: el borrador al atlas, texturas aún no usadas en él, el borrado inicial) y «cmd» (el dibujo, en una
 *   pantalla propia de W x H: un <canvas>, lo pintado se queda entre fotogramas; al final, escalada a la de VideoOut).
 * - Una textura que ya se usó en este fotograma y cambia (un lienzo reutilizado) se copia en «cmd», cortando el
 *   dibujo (vkCmdEndRendering, barrera, copia, otra vez a dibujar): el orden queda como en GL.
 * - Los datos (vértices, píxeles a subir) van a un montón por fotograma (2 en vuelo) que se recicla al esperar su valla.
 * - Todas las imágenes en VK_IMAGE_LAYOUT_GENERAL: sin transiciones, sólo barreras de memoria.
 * - B8G8R8A8_UNORM en todo: es el ARGB de PlutoVG tal cual en memoria (sin .bgra en el sombreador).
 * - Recorte (ctx.clip) en el stencil, como gpu.c: abanicos que invierten bits y luego sólo se pinta donde quedó a 0xff.
 *
 * Si no arranca (o existe <datos>/no-vulkan), gpu_open devuelve -1 y platform/ps5.c sigue con PlutoVG y su VideoOut.
 * El payload (sin PS5_TITLE) no puede tener la GPU (TITLE.md): ahí todo esto está vacío.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "gpu.h"

#ifndef PS5_TITLE
// ---------------- payload: sin GPU ----------------
int gpu_on;
int gpu_open(struct SDL_Window *win, int w, int h) { (void)win; (void)w; (void)h; return -1; }
void gpu_present(struct SDL_Window *win, double *copy_ms, double *wait_ms) { (void)win; (void)copy_ms; (void)wait_ms; }
void gpu_vk_close(void) {}
void gpu_prof(void (*say)(const char *fmt, ...), unsigned long frames) { (void)say; (void)frames; }
unsigned gpu_upload(unsigned tex, const Uint32 *px, int w, int h, int stride) { (void)tex; (void)px; (void)w; (void)h; (void)stride; return 0; }
void gpu_delete(unsigned tex) { (void)tex; }
unsigned gpu_image(const void *key, const Uint32 *px, int w, int h, int stride) { (void)key; (void)px; (void)w; (void)h; (void)stride; return 0; }
void gpu_forget(const void *key) { (void)key; }
void gpu_quad(unsigned tex, int tw, int th, int op, const float *xy, float sx, float sy, float sw, float sh,
              float r, float g, float b, float a) {
  (void)tex; (void)tw; (void)th; (void)op; (void)xy; (void)sx; (void)sy; (void)sw; (void)sh; (void)r; (void)g; (void)b; (void)a;
}
void gpu_scratch(const Uint32 *px, int stride, int x, int y, int w, int h, int op) { (void)px; (void)stride; (void)x; (void)y; (void)w; (void)h; (void)op; }
void gpu_read(Uint32 *dst, int w, int h) { (void)dst; (void)w; (void)h; }
void gpu_clip(const float *xy, const int *count, int npoly) { (void)xy; (void)count; (void)npoly; }
void gpu_clip_off(void) {}
#else

#include <unistd.h>
#include <SDL2/SDL.h>
#pragma clang diagnostic ignored "-Wmissing-field-initializers"   // ({ sType } y el resto a cero, a propósito)
#define VK_NO_PROTOTYPES
#include <vulkan/vulkan.h>
#include "platform.h"
#include "gpu_vk_vert.h"   // gpu_vk_vert[], gpu_vk_frag[]: title/shaders/quad.*, a SPIR-V con glslangValidator (build-title.sh)
#include "gpu_vk_frag.h"

VKAPI_ATTR PFN_vkVoidFunction VKAPI_CALL vk_icdGetInstanceProcAddr(VkInstance, const char*);

int gpu_on;

#define VKI(X) X(EnumeratePhysicalDevices) X(GetPhysicalDeviceProperties) X(GetPhysicalDeviceQueueFamilyProperties) \
  X(GetPhysicalDeviceMemoryProperties) X(GetPhysicalDeviceFormatProperties) X(CreateDevice) X(GetDeviceProcAddr) \
  X(GetPhysicalDeviceDisplayPropertiesKHR) X(GetDisplayModePropertiesKHR) X(CreateDisplayPlaneSurfaceKHR) \
  X(GetPhysicalDeviceSurfaceCapabilitiesKHR) X(GetPhysicalDeviceSurfaceSupportKHR) X(DestroySurfaceKHR)
#define VKD(X) X(GetDeviceQueue) X(CreateCommandPool) X(AllocateCommandBuffers) X(BeginCommandBuffer) X(EndCommandBuffer) \
  X(CreateFence) X(WaitForFences) X(ResetFences) X(CreateSemaphore) X(QueueSubmit) X(DeviceWaitIdle) \
  X(CreateSwapchainKHR) X(GetSwapchainImagesKHR) X(AcquireNextImageKHR) X(QueuePresentKHR) X(DestroySwapchainKHR) \
  X(CreateImage) X(DestroyImage) X(GetImageMemoryRequirements) X(AllocateMemory) X(FreeMemory) X(BindImageMemory) \
  X(CreateImageView) X(DestroyImageView) X(CreateBuffer) X(GetBufferMemoryRequirements) X(BindBufferMemory) \
  X(MapMemory) X(CreateSampler) X(CreateDescriptorSetLayout) X(CreatePipelineLayout) X(CreateShaderModule) \
  X(CreateGraphicsPipelines) X(CmdPipelineBarrier) X(CmdCopyBufferToImage) X(CmdCopyImageToBuffer) X(CmdBlitImage) \
  X(CmdClearColorImage) X(CmdBeginRendering) X(CmdEndRendering) X(CmdBindPipeline) X(CmdBindVertexBuffers) \
  X(CmdPushConstants) X(CmdPushDescriptorSetKHR) X(CmdSetViewport) X(CmdSetScissor) X(CmdDraw) X(CmdClearAttachments)
#define DECL(n) PFN_vk##n n;
static struct { PFN_vkCreateInstance CreateInstance; VKI(DECL) VKD(DECL) } vk;
#undef DECL

static VkInstance inst;
static VkPhysicalDevice phys;
static VkPhysicalDeviceMemoryProperties memp;
static VkDevice dev;
static VkQueue queue;
static VkSurfaceKHR surface;
static VkSwapchainKHR swapchain;
static VkImage sw_img[8];
static VkSemaphore sw_done[8];   // por imagen de la cadena: «ya se puede presentar»
static uint32_t n_sw;
static VkExtent2D sw_ext;
static VkCommandPool pool;
static VkPipelineLayout layout;
static VkPipeline pipes[11][2], pipe_clipw;   // [modo de mezcla][con recorte]; el que escribe el recorte
static VkFormat st_fmt;
static int st_depth;             // el formato del stencil también tiene profundidad (entonces va de las dos cosas)
static int W, H;

static int
die(const char *what, VkResult r) {
  fprintf(stderr, "[gpu] Vulkan: %s falló (%d); sigue PlutoVG\n", what, (int)r);
  return -1;
}
#define TRY(x, what) do { VkResult r_ = (x); if(r_ != VK_SUCCESS) return die(what, r_); } while(0)

static double
ms_now(void) { return SDL_GetPerformanceCounter() * 1000.0 / SDL_GetPerformanceFrequency(); }

static int
mem_type(uint32_t bits, VkMemoryPropertyFlags want) {
  for(uint32_t i = 0; i < memp.memoryTypeCount; i++)
    if(bits & 1u << i && (memp.memoryTypes[i].propertyFlags & want) == want) return (int)i;
  return -1;
}

static VkDeviceMemory
alloc_mem(VkMemoryRequirements req, VkMemoryPropertyFlags want, VkMemoryPropertyFlags fallback) {
  VkDeviceMemory m = VK_NULL_HANDLE;
  int t = mem_type(req.memoryTypeBits, want);
  if(t < 0) t = mem_type(req.memoryTypeBits, fallback);
  if(t < 0) return VK_NULL_HANDLE;
  VkMemoryAllocateInfo ai = { VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO, NULL, req.size, (uint32_t)t };
  return vk.AllocateMemory(dev, &ai, NULL, &m) == VK_SUCCESS ? m : VK_NULL_HANDLE;
}

// ---------------- imágenes ----------------
typedef struct { VkImage img; VkDeviceMemory mem; VkImageView view; } vkimg_t;

static int
make_image(vkimg_t *o, int w, int h, VkFormat fmt, VkImageUsageFlags usage, VkImageAspectFlags aspect) {
  VkMemoryRequirements req;
  VkImageCreateInfo ic = { VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO };
  ic.imageType = VK_IMAGE_TYPE_2D; ic.format = fmt; ic.extent = (VkExtent3D){ (uint32_t)w, (uint32_t)h, 1 };
  ic.mipLevels = ic.arrayLayers = 1; ic.samples = VK_SAMPLE_COUNT_1_BIT; ic.tiling = VK_IMAGE_TILING_OPTIMAL;
  ic.usage = usage; ic.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  memset(o, 0, sizeof *o);
  if(vk.CreateImage(dev, &ic, NULL, &o->img) != VK_SUCCESS) return -1;
  vk.GetImageMemoryRequirements(dev, o->img, &req);
  // ponytail: una asignación por imagen; si la PS5 se queda corta de asignaciones o de memoria, un montón propio.
  if(!(o->mem = alloc_mem(req, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, 0)) || vk.BindImageMemory(dev, o->img, o->mem, 0) != VK_SUCCESS)
    return -1;
  VkImageViewCreateInfo vc = { VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO };
  vc.image = o->img; vc.viewType = VK_IMAGE_VIEW_TYPE_2D; vc.format = fmt;
  vc.subresourceRange = (VkImageSubresourceRange){ aspect, 0, 1, 0, 1 };
  return vk.CreateImageView(dev, &vc, NULL, &o->view) == VK_SUCCESS ? 0 : -1;
}

// ---------------- fotogramas en vuelo ----------------
#define NF 2
#define CHUNK (16u << 20)
#define MAXCH 64
#define MAXDEAD 4096
typedef struct { VkBuffer buf; VkDeviceMemory mem; Uint8 *map; size_t size; } chunk_t;
static struct frame {
  VkCommandBuffer pre, cmd;
  VkFence fence;
  VkSemaphore acquired;
  chunk_t ch[MAXCH];
  int nch, cur;
  size_t off;
  vkimg_t dead[MAXDEAD];     // lo borrado durante este fotograma: se destruye al volver a él (ya no lo usa la GPU)
  int ndead;
} fr[NF], *F;
static unsigned frame_no = 1;
static int rendering;            // dentro de vkCmdBeginRendering en F->cmd
static VkPipeline bound_pipe;
static unsigned bound_tex;

// Sitio en el montón del fotograma para n bytes (vértices, píxeles a copiar). NULL si no hay (se pierde ese dibujo).
static Uint8*
stage(size_t n, VkBuffer *buf, VkDeviceSize *off) {
  n = (n + 15) & ~(size_t)15;
  for(;;) {
    if(F->cur < F->nch) {
      chunk_t *c = &F->ch[F->cur];
      if(F->off + n <= c->size) { *buf = c->buf; *off = F->off; F->off += n; return c->map + *off; }
      F->cur++; F->off = 0;
      continue;
    }
    if(F->nch == MAXCH) return NULL;   // ponytail: tope de 64 trozos por fotograma (1 GB con los de 16 MB)
    chunk_t *c = &F->ch[F->nch];
    VkMemoryRequirements req;
    VkBufferCreateInfo bc = { VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO };
    bc.size = n > CHUNK ? n : CHUNK;
    bc.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT | VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
    if(vk.CreateBuffer(dev, &bc, NULL, &c->buf) != VK_SUCCESS) return NULL;
    vk.GetBufferMemoryRequirements(dev, c->buf, &req);
    if(!(c->mem = alloc_mem(req, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT, 0)) ||
       vk.BindBufferMemory(dev, c->buf, c->mem, 0) != VK_SUCCESS ||
       vk.MapMemory(dev, c->mem, 0, VK_WHOLE_SIZE, 0, (void**)&c->map) != VK_SUCCESS) return NULL;
    c->size = bc.size;
    F->nch++;
  }
}

static void
barrier(VkCommandBuffer cb, VkPipelineStageFlags src, VkAccessFlags sa, VkPipelineStageFlags dst, VkAccessFlags da) {
  VkMemoryBarrier mb = { VK_STRUCTURE_TYPE_MEMORY_BARRIER, NULL, sa, da };
  vk.CmdPipelineBarrier(cb, src, dst, 0, 1, &mb, 0, NULL, 0, NULL);
}

static void
to_general(VkCommandBuffer cb, VkImage img, VkImageAspectFlags aspect) {
  VkImageMemoryBarrier ib = { VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER };
  ib.dstAccessMask = VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT;
  ib.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED; ib.newLayout = VK_IMAGE_LAYOUT_GENERAL;
  ib.srcQueueFamilyIndex = ib.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  ib.image = img; ib.subresourceRange = (VkImageSubresourceRange){ aspect, 0, 1, 0, 1 };
  vk.CmdPipelineBarrier(cb, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, 0, 0, NULL, 0, NULL, 1, &ib);
}

static void
begin_frame(void) {
  VkCommandBufferBeginInfo bi = { VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO, NULL, VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT };
  const float size[2] = { (float)W, (float)H };
  VkViewport vp = { 0, 0, (float)W, (float)H, 0, 1 };
  VkRect2D sc = { { 0, 0 }, { (uint32_t)W, (uint32_t)H } };
  vk.BeginCommandBuffer(F->pre, &bi);
  vk.BeginCommandBuffer(F->cmd, &bi);
  // Lo de los fotogramas anteriores (dibujo, lecturas de texturas, la copia a la cadena) antes de las copias de éste.
  barrier(F->pre, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, VK_ACCESS_MEMORY_WRITE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_WRITE_BIT);
  vk.CmdSetViewport(F->cmd, 0, 1, &vp);
  vk.CmdSetScissor(F->cmd, 0, 1, &sc);
  vk.CmdPushConstants(F->cmd, layout, VK_SHADER_STAGE_VERTEX_BIT, 0, sizeof size, size);
  bound_pipe = VK_NULL_HANDLE; bound_tex = 0; rendering = 0;
}

// ---------------- texturas ----------------
// Un número por textura (lo que canvas.c guarda); 0 = blanco.
#define MAXTEX 16384
static struct { vkimg_t im; int w, h; unsigned used; } tex[MAXTEX];   // used: el último fotograma que la dibujó
static unsigned free_ids[MAXTEX], n_free, n_tex = 1, white;

static vkimg_t rt, st;           // la pantalla del juego y su stencil
static VkFormat RT_FMT = VK_FORMAT_B8G8R8A8_UNORM;

static void
bury(vkimg_t *im) {
  if(!im->img) return;
  if(F->ndead == MAXDEAD) {   // ponytail: lleno (miles de borrados en un fotograma): esperar a la GPU y destruir ya
    vk.DeviceWaitIdle(dev);
    for(int i = 0; i < F->ndead; i++) { vk.DestroyImageView(dev, F->dead[i].view, NULL); vk.DestroyImage(dev, F->dead[i].img, NULL); vk.FreeMemory(dev, F->dead[i].mem, NULL); }
    F->ndead = 0;
  }
  F->dead[F->ndead++] = *im;
  memset(im, 0, sizeof *im);
}

// ---------------- lotes ----------------
#define MAXV (6 * 8192)
static float vb[MAXV * 8];       // x, y, u, v, r, g, b, a
static int nv, cur_op = -1, clip_on, clip_write;
static unsigned cur_tex;
static struct { unsigned long draws, quads, breaks, up_pre, up_cmd, scratch; double up_kb, rec_ms, wait_ms; } st_n;

static void
rend_begin(void) {
  if(rendering) return;
  VkRenderingAttachmentInfo ca = { VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO };
  VkRenderingAttachmentInfo sa = { VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO };
  VkRenderingInfo ri = { VK_STRUCTURE_TYPE_RENDERING_INFO };
  ca.imageView = rt.view; ca.imageLayout = VK_IMAGE_LAYOUT_GENERAL;
  ca.loadOp = VK_ATTACHMENT_LOAD_OP_LOAD; ca.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
  sa = ca; sa.imageView = st.view;
  ri.renderArea = (VkRect2D){ { 0, 0 }, { (uint32_t)W, (uint32_t)H } };
  ri.layerCount = 1; ri.colorAttachmentCount = 1; ri.pColorAttachments = &ca;
  ri.pStencilAttachment = &sa;
  if(st_depth) ri.pDepthAttachment = &sa;
  vk.CmdBeginRendering(F->cmd, &ri);
  rendering = 1;
  st_n.breaks++;
}

static void
rend_end(void) {
  if(!rendering) return;
  vk.CmdEndRendering(F->cmd);
  rendering = 0;
}

static void
flush(void) {
  VkBuffer buf;
  VkDeviceSize off;
  Uint8 *p;
  VkPipeline pp;
  if(!nv) return;
  if(!(p = stage((size_t)nv * 32, &buf, &off))) { nv = 0; return; }
  memcpy(p, vb, (size_t)nv * 32);
  rend_begin();
  pp = clip_write ? pipe_clipw : pipes[cur_op][clip_on];
  if(pp != bound_pipe) { vk.CmdBindPipeline(F->cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pp); bound_pipe = pp; }
  if(cur_tex != bound_tex) {
    VkDescriptorImageInfo ii = { VK_NULL_HANDLE, tex[cur_tex].im.view, VK_IMAGE_LAYOUT_GENERAL };
    VkWriteDescriptorSet w = { VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET };
    w.descriptorCount = 1; w.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER; w.pImageInfo = &ii;
    vk.CmdPushDescriptorSetKHR(F->cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout, 0, 1, &w);
    bound_tex = cur_tex;
  }
  vk.CmdBindVertexBuffers(F->cmd, 0, 1, &buf, &off);
  vk.CmdDraw(F->cmd, (uint32_t)nv, 1, 0, 0);
  tex[cur_tex].used = frame_no;
  st_n.draws++; st_n.quads += nv / 6;
  nv = 0;
}

void
gpu_quad(unsigned t, int tw, int th, int op, const float *xy, float sx, float sy, float sw, float sh,
         float r, float g, float b, float a) {
  const float u0 = sx / tw, v0 = sy / th, u1 = (sx + sw) / tw, v1 = (sy + sh) / th;
  const float uv[8] = { u0, v0, u1, v0, u1, v1, u0, v1 };
  static const int idx[6] = { 0, 1, 2, 0, 2, 3 };
  if(!t || t >= MAXTEX || !tex[t].im.view) t = white;
  if(op < 0 || op > 10) op = 0;
  if(t != cur_tex || op != cur_op || nv + 6 > MAXV) { flush(); cur_tex = t; cur_op = op; }
  for(int i = 0; i < 6; i++) {
    float *v = vb + (size_t)nv++ * 8;
    const int k = idx[i];
    v[0] = xy[k * 2]; v[1] = xy[k * 2 + 1]; v[2] = uv[k * 2]; v[3] = uv[k * 2 + 1];
    v[4] = r; v[5] = g; v[6] = b; v[7] = a;
  }
}

// ---------------- recorte (ctx.clip) ----------------
void
gpu_clip(const float *xy, const int *count, int npoly) {
  VkClearAttachment ca = { VK_IMAGE_ASPECT_STENCIL_BIT, 0, { .depthStencil = { 0, 0 } } };
  VkClearRect cr = { { { 0, 0 }, { (uint32_t)W, (uint32_t)H } }, 0, 1 };
  flush();
  rend_begin();
  vk.CmdClearAttachments(F->cmd, 1, &ca, 1, &cr);
  clip_write = 1; cur_tex = white; cur_op = 0;
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
  clip_write = 0;
  clip_on = 1;
}

void
gpu_clip_off(void) {
  if(!clip_on) return;
  flush();
  clip_on = 0;
}

// ---------------- subir texturas ----------------
// Los píxeles al montón y una copia a la imagen: en «pre» si este fotograma aún no la dibujó (sin cortar nada), y si
// no, en «cmd» cortando el dibujo (lo dibujado antes la ve como estaba).
static void
copy_in(unsigned t, int fresh, const Uint32 *px, int stride, int x, int y, int w, int h) {
  VkBuffer buf;
  VkDeviceSize off;
  const size_t n = ((size_t)(h - 1) * stride + w) * 4;
  Uint8 *p = stage(n, &buf, &off);
  VkBufferImageCopy rg = { 0 };
  const int late = tex[t].used == frame_no;
  VkCommandBuffer cb = late ? F->cmd : F->pre;
  if(!p) return;
  memcpy(p, px, n);
  rg.bufferOffset = off; rg.bufferRowLength = (uint32_t)stride;
  rg.imageSubresource = (VkImageSubresourceLayers){ VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1 };
  rg.imageOffset = (VkOffset3D){ x, y, 0 }; rg.imageExtent = (VkExtent3D){ (uint32_t)w, (uint32_t)h, 1 };
  if(late) { flush(); rend_end(); }
  if(fresh) to_general(cb, tex[t].im.img, VK_IMAGE_ASPECT_COLOR_BIT);
  else barrier(cb, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, VK_ACCESS_MEMORY_WRITE_BIT,   // (tras otra copia o el dibujo de antes)
               VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_WRITE_BIT);
  vk.CmdCopyBufferToImage(cb, buf, tex[t].im.img, VK_IMAGE_LAYOUT_GENERAL, 1, &rg);
  if(late) { barrier(cb, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_WRITE_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT, VK_ACCESS_SHADER_READ_BIT); st_n.up_cmd++; }
  else st_n.up_pre++;
  st_n.up_kb += n / 1024.0;
}

unsigned
gpu_upload(unsigned t, const Uint32 *px, int w, int h, int stride) {
  int fresh = 0;
  if(t && t == cur_tex) flush();   // (los cuadriláteros pendientes la ven como estaba)
  if(!t) {
    if(n_free) t = free_ids[--n_free];
    else if(n_tex < MAXTEX) t = n_tex++;
    else return 0;   // ponytail: 16384 texturas a la vez como mucho (se pinta en blanco)
  }
  if(!tex[t].im.img || tex[t].w != w || tex[t].h != h) {
    bury(&tex[t].im);
    if(make_image(&tex[t].im, w, h, RT_FMT, VK_IMAGE_USAGE_SAMPLED_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT, VK_IMAGE_ASPECT_COLOR_BIT)) {
      fprintf(stderr, "[gpu] Vulkan: sin memoria para una textura de %dx%d\n", w, h);
      bury(&tex[t].im);
      return t;
    }
    tex[t].w = w; tex[t].h = h; tex[t].used = 0;
    fresh = 1;
  }
  if(px) copy_in(t, fresh, px, stride, 0, 0, w, h);
  return t;
}

void
gpu_delete(unsigned t) {
  if(!t || t >= MAXTEX || t == white) return;
  if(t == cur_tex) flush();
  bury(&tex[t].im);
  tex[t].w = tex[t].h = 0;
  free_ids[n_free++] = t;   // (el número ya puede volver: lo grabado guarda la vista, no el número)
}

// Imágenes que no cambian: tabla por dirección, como gpu.c (ver allí).
#define IMG_N 8192
static struct { const void *key; unsigned tex; } img[IMG_N];
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
    if(img[i].key == key) { gpu_delete(img[i].tex); img[i].key = (const void*)1; img[i].tex = 0; return; }
    if(!img[i].key && !img[i].tex) return;
  }
}

// ---------------- el borrador ----------------
// Lo que pinta PlutoVG en la pantalla, a un atlas por estantes. Cada trozo es nuevo en el fotograma, así que su copia
// va siempre a «pre». Si se llena, el siguiente atlas (nunca se reescribe uno dentro del mismo fotograma).
#define ATLAS 2048
#define MAXATLAS 32
static unsigned atlas[MAXATLAS];
static int n_atlas, ai, ax, ay, arow;

void
gpu_scratch(const Uint32 *px, int stride, int x, int y, int w, int h, int op) {
  float xy[8];
  if(w <= 0 || h <= 0 || w > ATLAS || h > ATLAS) return;
  if(ax + w > ATLAS) { ax = 0; ay += arow; arow = 0; }
  if(ay + h > ATLAS) {
    if(ai + 1 == MAXATLAS) return;   // ponytail: 32 atlas de 2048² por fotograma; más, se pierde el trozo
    ai++; ax = ay = arow = 0;
  }
  if(ai >= n_atlas) {
    if(!(atlas[n_atlas] = gpu_upload(0, NULL, ATLAS, ATLAS, ATLAS)) || !tex[atlas[n_atlas]].im.img) return;
    to_general(F->pre, tex[atlas[n_atlas]].im.img, VK_IMAGE_ASPECT_COLOR_BIT);
    n_atlas++;
  }
  {
    VkBuffer buf;
    VkDeviceSize off;
    const size_t n = ((size_t)(h - 1) * stride + w) * 4;
    Uint8 *p = stage(n, &buf, &off);
    VkBufferImageCopy rg = { 0 };
    if(!p) return;
    memcpy(p, px, n);
    rg.bufferOffset = off; rg.bufferRowLength = (uint32_t)stride;
    rg.imageSubresource = (VkImageSubresourceLayers){ VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1 };
    rg.imageOffset = (VkOffset3D){ ax, ay, 0 }; rg.imageExtent = (VkExtent3D){ (uint32_t)w, (uint32_t)h, 1 };
    vk.CmdCopyBufferToImage(F->pre, buf, tex[atlas[ai]].im.img, VK_IMAGE_LAYOUT_GENERAL, 1, &rg);
    st_n.scratch++; st_n.up_kb += n / 1024.0;
  }
  xy[0] = xy[6] = (float)x; xy[2] = xy[4] = (float)(x + w);
  xy[1] = xy[3] = (float)y; xy[5] = xy[7] = (float)(y + h);
  gpu_quad(atlas[ai], ATLAS, ATLAS, op, xy, (float)ax, (float)ay, (float)w, (float)h, 1, 1, 1, 1);
  ax += w;
  if(h > arow) arow = h;
}

// ---------------- enviar ----------------
static void
end_cmds(void) {
  // Las copias de «pre», antes que todo lo de «cmd».
  barrier(F->pre, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_WRITE_BIT, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
          VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT);
  vk.EndCommandBuffer(F->pre);
  vk.EndCommandBuffer(F->cmd);
}

static VkResult
submit(VkSemaphore wait, VkSemaphore signal) {
  const VkPipelineStageFlags ws = VK_PIPELINE_STAGE_TRANSFER_BIT;
  VkCommandBuffer cbs[2] = { F->pre, F->cmd };
  VkSubmitInfo si = { VK_STRUCTURE_TYPE_SUBMIT_INFO };
  si.waitSemaphoreCount = wait ? 1 : 0; si.pWaitSemaphores = &wait; si.pWaitDstStageMask = &ws;
  si.commandBufferCount = 2; si.pCommandBuffers = cbs;
  si.signalSemaphoreCount = signal ? 1 : 0; si.pSignalSemaphores = &signal;
  return vk.QueueSubmit(queue, 1, &si, F->fence);
}

// El fotograma F otra vez desde cero: espera a que la GPU lo acabe (lo de hace NF fotogramas) y recicla lo suyo.
static double
recycle(void) {
  const double t0 = ms_now();
  vk.WaitForFences(dev, 1, &F->fence, VK_TRUE, UINT64_MAX);
  vk.ResetFences(dev, 1, &F->fence);
  for(int i = 0; i < F->ndead; i++) {
    vk.DestroyImageView(dev, F->dead[i].view, NULL); vk.DestroyImage(dev, F->dead[i].img, NULL); vk.FreeMemory(dev, F->dead[i].mem, NULL);
  }
  F->ndead = 0; F->cur = 0; F->off = 0;
  return ms_now() - t0;
}

void
gpu_read(Uint32 *dst, int w, int h) {
  static VkBuffer rb;
  static Uint8 *rb_map;
  if(w != W || h != H) return;
  flush();
  rend_end();
  if(!rb) {
    VkMemoryRequirements req;
    VkDeviceMemory m;
    VkBufferCreateInfo bc = { VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO };
    bc.size = (VkDeviceSize)W * H * 4; bc.usage = VK_BUFFER_USAGE_TRANSFER_DST_BIT;
    if(vk.CreateBuffer(dev, &bc, NULL, &rb) != VK_SUCCESS) { rb = VK_NULL_HANDLE; return; }
    vk.GetBufferMemoryRequirements(dev, rb, &req);
    if(!(m = alloc_mem(req, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT, 0)) ||
       vk.BindBufferMemory(dev, rb, m, 0) != VK_SUCCESS || vk.MapMemory(dev, m, 0, VK_WHOLE_SIZE, 0, (void**)&rb_map) != VK_SUCCESS) {
      rb = VK_NULL_HANDLE; return;
    }
  }
  VkBufferImageCopy rg = { 0 };
  rg.imageSubresource = (VkImageSubresourceLayers){ VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1 };
  rg.imageExtent = (VkExtent3D){ (uint32_t)W, (uint32_t)H, 1 };
  barrier(F->cmd, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT, VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_READ_BIT);
  vk.CmdCopyImageToBuffer(F->cmd, rt.img, VK_IMAGE_LAYOUT_GENERAL, rb, 1, &rg);
  barrier(F->cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_WRITE_BIT, VK_PIPELINE_STAGE_HOST_BIT, VK_ACCESS_HOST_READ_BIT);
  // ponytail: se envía lo grabado y se espera a la GPU (getImageData de la pantalla, ps.shot: raro).
  end_cmds();
  submit(VK_NULL_HANDLE, VK_NULL_HANDLE);
  vk.WaitForFences(dev, 1, &F->fence, VK_TRUE, UINT64_MAX);
  vk.ResetFences(dev, 1, &F->fence);   // (los datos del montón ya se usaron: se siguen añadiendo detrás)
  begin_frame();
  memcpy(dst, rb_map, (size_t)W * H * 4);   // (B8G8R8A8 = ARGB de PlutoVG, de arriba abajo)
}

void
gpu_present(struct SDL_Window *win, double *copy_ms, double *wait_ms) {
  const double t0 = ms_now();
  double waited;
  uint32_t idx = 0;
  VkResult r;
  (void)win;
  gpu_step = "flush";
  flush();
  rend_end();
  gpu_step = "acquire";
  const double t_fl = ms_now();
  r = vk.AcquireNextImageKHR(dev, swapchain, UINT64_MAX, F->acquired, VK_NULL_HANDLE, &idx);   // (FIFO: aquí espera al vblank)
  const double t_aq = ms_now();
  waited = t_aq - t0;
  const int ok = r == VK_SUCCESS || r == VK_SUBOPTIMAL_KHR;
  if(ok) {
    // La pantalla del juego, escalada al píxel más cercano y centrada (con bandas si no es 16:9), a la imagen de la cadena.
    VkImageMemoryBarrier ib = { VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER };
    int vw = (int)sw_ext.width, vh = (int)sw_ext.width * H / W;
    if(vh > (int)sw_ext.height) { vh = (int)sw_ext.height; vw = (int)sw_ext.height * W / H; }
    const int dx = ((int)sw_ext.width - vw) / 2, dy = ((int)sw_ext.height - vh) / 2;
    VkImageBlit bl = { { VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1 }, { { 0, 0, 0 }, { W, H, 1 } },
                       { VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1 }, { { dx, dy, 0 }, { dx + vw, dy + vh, 1 } } };
    barrier(F->cmd, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT, VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_READ_BIT);
    ib.srcAccessMask = 0; ib.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    ib.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED; ib.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    ib.srcQueueFamilyIndex = ib.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    ib.image = sw_img[idx]; ib.subresourceRange = (VkImageSubresourceRange){ VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 };
    vk.CmdPipelineBarrier(F->cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, NULL, 0, NULL, 1, &ib);
    if(dx || dy) {
      const VkClearColorValue black = { .float32 = { 0, 0, 0, 1 } };
      vk.CmdClearColorImage(F->cmd, sw_img[idx], VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, &black, 1, &ib.subresourceRange);
      barrier(F->cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_WRITE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_WRITE_BIT);
    }
    vk.CmdBlitImage(F->cmd, rt.img, VK_IMAGE_LAYOUT_GENERAL, sw_img[idx], VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &bl, VK_FILTER_NEAREST);
    ib.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT; ib.dstAccessMask = 0;
    ib.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL; ib.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
    vk.CmdPipelineBarrier(F->cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, 0, 0, NULL, 0, NULL, 1, &ib);
  } else {
    static int told;
    if(!told++) fprintf(stderr, "[gpu] Vulkan: vkAcquireNextImageKHR %d (no se presenta)\n", (int)r);
  }
  gpu_step = "submit";
  end_cmds();
  const double t_rec = ms_now();
  if(submit(ok ? F->acquired : VK_NULL_HANDLE, ok ? sw_done[idx] : VK_NULL_HANDLE) != VK_SUCCESS) {
    static int told;
    if(!told++) fprintf(stderr, "[gpu] Vulkan: vkQueueSubmit falló\n");
  }
  gpu_step = "present";
  if(ok) {
    VkPresentInfoKHR pi = { VK_STRUCTURE_TYPE_PRESENT_INFO_KHR };
    pi.waitSemaphoreCount = 1; pi.pWaitSemaphores = &sw_done[idx];
    pi.swapchainCount = 1; pi.pSwapchains = &swapchain; pi.pImageIndices = &idx;
    vk.QueuePresentKHR(queue, &pi);
  }
  const double t_pr = ms_now();
  F = &fr[frame_no % NF];
  gpu_step = "fence";
  const double t_cy = recycle();
  gpu_step = "";
  waited += t_cy;
  // Diagnóstico (18-11-2026): en cooperativo la PS5 se quedaba segundos (y al final para siempre) en «presentar»:
  // qué paso es el que se para.
  if(ms_now() - t0 > 200)
    fprintf(stderr, "[gpu] presentar lento %lu: flush %.0f · acquire %.0f · grabar %.0f · submit+present %.0f · fence %.0f ms\n",
            (unsigned long)frame_no, t_fl - t0, t_aq - t_fl, t_rec - t_aq, t_pr - t_rec, t_cy);
  frame_no++;
  ai = ax = ay = arow = 0;
  cur_tex = 0; cur_op = -1;
  begin_frame();
  *wait_ms = waited;
  *copy_ms = ms_now() - t0 - waited;
  st_n.rec_ms += *copy_ms; st_n.wait_ms += waited;
}

// Una línea para el log (main.c, junto a [dibujo]): lo de la GPU por fotograma.
void
gpu_prof(void (*say)(const char *fmt, ...), unsigned long frames) {
  if(frames)
    say("[gpu] Vulkan por fotograma: %lu dibujos, %lu cuadriláteros, %lu cortes, subidas %lu antes + %lu cortando, borrador %lu"
        " (%.0f KB en total) · grabar %.2f ms, esperar %.1f ms · %lu atlas, %d texturas\n",
        st_n.draws / frames, st_n.quads / frames, st_n.breaks / frames, st_n.up_pre / frames, st_n.up_cmd / frames,
        st_n.scratch / frames, st_n.up_kb / frames, st_n.rec_ms / frames, st_n.wait_ms / frames, (unsigned long)n_atlas,
        (int)(n_tex - 1 - n_free));
  memset(&st_n, 0, sizeof st_n);
}

// ---------------- arranque ----------------
static VkShaderModule
shader(const uint32_t *code, size_t size) {
  VkShaderModule m = VK_NULL_HANDLE;
  VkShaderModuleCreateInfo ci = { VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO, NULL, 0, size, code };
  return vk.CreateShaderModule(dev, &ci, NULL, &m) == VK_SUCCESS ? m : VK_NULL_HANDLE;
}

static VkPipeline
pipeline(VkShaderModule vs, VkShaderModule fs, int op, int clip) {   // clip: 0 sin recorte, 1 dentro, 2 escribirlo
  static const VkBlendFactor BL[11][2] = {   // los modos de canvas.js, como gpu.c
    { VK_BLEND_FACTOR_ONE, VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA },              // source-over
    { VK_BLEND_FACTOR_DST_ALPHA, VK_BLEND_FACTOR_ZERO },                       // source-in
    { VK_BLEND_FACTOR_ONE_MINUS_DST_ALPHA, VK_BLEND_FACTOR_ZERO },             // source-out
    { VK_BLEND_FACTOR_DST_ALPHA, VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA },        // source-atop
    { VK_BLEND_FACTOR_ONE_MINUS_DST_ALPHA, VK_BLEND_FACTOR_ONE },              // destination-over
    { VK_BLEND_FACTOR_ZERO, VK_BLEND_FACTOR_SRC_ALPHA },                       // destination-in
    { VK_BLEND_FACTOR_ZERO, VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA },             // destination-out
    { VK_BLEND_FACTOR_ONE_MINUS_DST_ALPHA, VK_BLEND_FACTOR_SRC_ALPHA },        // destination-atop
    { VK_BLEND_FACTOR_ONE_MINUS_DST_ALPHA, VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA },   // xor
    { VK_BLEND_FACTOR_ONE, VK_BLEND_FACTOR_ZERO },                             // copy
    { VK_BLEND_FACTOR_ZERO, VK_BLEND_FACTOR_ZERO },                            // clear
  };
  static const VkVertexInputBindingDescription bind = { 0, 32, VK_VERTEX_INPUT_RATE_VERTEX };
  static const VkVertexInputAttributeDescription attr[3] = {
    { 0, 0, VK_FORMAT_R32G32_SFLOAT, 0 }, { 1, 0, VK_FORMAT_R32G32_SFLOAT, 8 }, { 2, 0, VK_FORMAT_R32G32B32A32_SFLOAT, 16 } };
  static const VkDynamicState dyn[2] = { VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR };
  VkPipelineShaderStageCreateInfo stages[2] = {
    { VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO, NULL, 0, VK_SHADER_STAGE_VERTEX_BIT, vs, "main", NULL },
    { VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO, NULL, 0, VK_SHADER_STAGE_FRAGMENT_BIT, fs, "main", NULL } };
  VkPipelineVertexInputStateCreateInfo vi = { VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO, NULL, 0, 1, &bind, 3, attr };
  VkPipelineInputAssemblyStateCreateInfo ia = { VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO, NULL, 0, VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST, VK_FALSE };
  VkPipelineViewportStateCreateInfo vp = { VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO, NULL, 0, 1, NULL, 1, NULL };
  VkPipelineRasterizationStateCreateInfo rs = { VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO };
  VkPipelineMultisampleStateCreateInfo ms = { VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO };
  VkPipelineDepthStencilStateCreateInfo ds = { VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO };
  VkPipelineColorBlendAttachmentState ba = { 0 };
  VkPipelineColorBlendStateCreateInfo cb = { VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO };
  VkPipelineDynamicStateCreateInfo dy = { VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO, NULL, 0, 2, dyn };
  VkPipelineRenderingCreateInfo pr = { VK_STRUCTURE_TYPE_PIPELINE_RENDERING_CREATE_INFO };
  VkGraphicsPipelineCreateInfo gp = { VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO };
  VkPipeline p = VK_NULL_HANDLE;
  rs.polygonMode = VK_POLYGON_MODE_FILL; rs.cullMode = VK_CULL_MODE_NONE; rs.frontFace = VK_FRONT_FACE_CLOCKWISE; rs.lineWidth = 1;
  ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;
  if(clip) {
    ds.stencilTestEnable = VK_TRUE;
    ds.front.compareMask = 0xff;
    if(clip == 2) { ds.front.compareOp = VK_COMPARE_OP_ALWAYS; ds.front.passOp = VK_STENCIL_OP_INVERT; ds.front.writeMask = 0xff; }
    else { ds.front.compareOp = VK_COMPARE_OP_EQUAL; ds.front.reference = 0xff; }
    ds.back = ds.front;
  }
  ba.blendEnable = VK_TRUE;
  ba.srcColorBlendFactor = ba.srcAlphaBlendFactor = BL[op][0];
  ba.dstColorBlendFactor = ba.dstAlphaBlendFactor = BL[op][1];
  ba.colorBlendOp = ba.alphaBlendOp = VK_BLEND_OP_ADD;
  ba.colorWriteMask = clip == 2 ? 0 : 0xf;
  cb.attachmentCount = 1; cb.pAttachments = &ba;
  pr.colorAttachmentCount = 1; pr.pColorAttachmentFormats = &RT_FMT;
  pr.stencilAttachmentFormat = st_fmt;
  pr.depthAttachmentFormat = st_depth ? st_fmt : VK_FORMAT_UNDEFINED;
  gp.pNext = &pr; gp.stageCount = 2; gp.pStages = stages; gp.pVertexInputState = &vi; gp.pInputAssemblyState = &ia;
  gp.pViewportState = &vp; gp.pRasterizationState = &rs; gp.pMultisampleState = &ms; gp.pDepthStencilState = &ds;
  gp.pColorBlendState = &cb; gp.pDynamicState = &dy; gp.layout = layout;
  return vk.CreateGraphicsPipelines(dev, VK_NULL_HANDLE, 1, &gp, NULL, &p) == VK_SUCCESS ? p : VK_NULL_HANDLE;
}

// La pantalla (VK_KHR_display sobre VideoOut, el de la consola): el modo de 1920x1080 a ~60 Hz si lo hay (VideoOut
// lo escala a la tele; menos píxeles que 4K para lo mismo), si no el más cercano a 60 Hz.
static int
open_display(void) {
  VkDisplayPropertiesKHR dp;
  VkDisplayModePropertiesKHR modes[16];
  uint32_t n = 1, best = 0;
  long bscore = -1;
  char list[512];
  int len = 0;
  TRY(vk.GetPhysicalDeviceDisplayPropertiesKHR(phys, &n, &dp) < 0 ? VK_ERROR_INITIALIZATION_FAILED : VK_SUCCESS, "vkGetPhysicalDeviceDisplayPropertiesKHR");
  if(!n) return die("sin pantalla (VK_KHR_display)", VK_ERROR_INITIALIZATION_FAILED);
  n = 16;
  if(vk.GetDisplayModePropertiesKHR(phys, dp.display, &n, modes) < 0 || !n) return die("vkGetDisplayModePropertiesKHR", VK_ERROR_INITIALIZATION_FAILED);
  for(uint32_t i = 0; i < n; i++) {
    const VkDisplayModeParametersKHR *m = &modes[i].parameters;
    long hz = (long)m->refreshRate - 60000, score = (hz < 0 ? -hz : hz) + (m->visibleRegion.width == 1920 ? 0 : 100000);
    if(len < (int)sizeof list - 40) len += snprintf(list + len, sizeof list - len, " %ux%u@%.2f", m->visibleRegion.width, m->visibleRegion.height, m->refreshRate / 1000.0);
    if(bscore < 0 || score < bscore) { bscore = score; best = i; }
  }
  VkDisplaySurfaceCreateInfoKHR si = { VK_STRUCTURE_TYPE_DISPLAY_SURFACE_CREATE_INFO_KHR };
  si.displayMode = modes[best].displayMode;
  si.transform = VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR;
  si.alphaMode = VK_DISPLAY_PLANE_ALPHA_OPAQUE_BIT_KHR;
  si.imageExtent = modes[best].parameters.visibleRegion;
  TRY(vk.CreateDisplayPlaneSurfaceKHR(inst, &si, NULL, &surface), "vkCreateDisplayPlaneSurfaceKHR");
  sw_ext = si.imageExtent;
  fprintf(stderr, "[gpu] Vulkan: pantalla «%s», modos%s → %ux%u a %.2f Hz\n", dp.displayName ? dp.displayName : "?",
          len ? list : " ?", sw_ext.width, sw_ext.height, modes[best].parameters.refreshRate / 1000.0);
  return 0;
}

static int
open_swapchain(uint32_t family) {
  VkSurfaceCapabilitiesKHR caps;
  VkBool32 ok = VK_FALSE;
  vk.GetPhysicalDeviceSurfaceSupportKHR(phys, family, surface, &ok);
  if(!ok) return die("la cola no presenta en la pantalla", VK_ERROR_INITIALIZATION_FAILED);
  TRY(vk.GetPhysicalDeviceSurfaceCapabilitiesKHR(phys, surface, &caps), "vkGetPhysicalDeviceSurfaceCapabilitiesKHR");
  if(!(caps.supportedUsageFlags & VK_IMAGE_USAGE_TRANSFER_DST_BIT)) return die("la cadena no admite copias", VK_ERROR_INITIALIZATION_FAILED);
  if(caps.currentExtent.width != 0xffffffffu) sw_ext = caps.currentExtent;
  VkSwapchainCreateInfoKHR ci = { VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR };
  ci.surface = surface;
  ci.minImageCount = caps.minImageCount > 3 ? caps.minImageCount : 3;
  if(caps.maxImageCount && ci.minImageCount > caps.maxImageCount) ci.minImageCount = caps.maxImageCount;
  ci.imageFormat = VK_FORMAT_B8G8R8A8_UNORM; ci.imageColorSpace = VK_COLOR_SPACE_SRGB_NONLINEAR_KHR;
  ci.imageExtent = sw_ext; ci.imageArrayLayers = 1; ci.imageUsage = VK_IMAGE_USAGE_TRANSFER_DST_BIT;
  ci.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE; ci.preTransform = VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR;
  ci.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR; ci.presentMode = VK_PRESENT_MODE_FIFO_KHR; ci.clipped = VK_TRUE;
  // Al reiniciar (ps.restart), la copia anterior aún puede tener la pantalla unos instantes: se reintenta (como ps5.c).
  VkResult r = VK_SUCCESS;
  for(int i = 0; i < 30 && (r = vk.CreateSwapchainKHR(dev, &ci, NULL, &swapchain)) != VK_SUCCESS; i++) SDL_Delay(100);
  TRY(r, "vkCreateSwapchainKHR");
  n_sw = 8;
  TRY(vk.GetSwapchainImagesKHR(dev, swapchain, &n_sw, sw_img), "vkGetSwapchainImagesKHR");
  VkSemaphoreCreateInfo sc = { VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO };
  for(uint32_t i = 0; i < n_sw; i++) TRY(vk.CreateSemaphore(dev, &sc, NULL, &sw_done[i]), "vkCreateSemaphore");
  return 0;
}

// Si algo falla a medias: soltar la pantalla (VideoOut) para que la use PlutoVG. Lo demás se queda (no molesta).
void
gpu_vk_close(void) {
  if(dev) vk.DeviceWaitIdle(dev);
  if(swapchain) { vk.DestroySwapchainKHR(dev, swapchain, NULL); swapchain = VK_NULL_HANDLE; }
  if(surface) { vk.DestroySurfaceKHR(inst, surface, NULL); surface = VK_NULL_HANDLE; }
  gpu_on = 0;
}

static int
open_all(int w, int h) {
  VkPhysicalDeviceProperties pp;
  VkQueueFamilyProperties qf[8];
  uint32_t n = 1, family = UINT32_MAX;
  W = w; H = h;
#define LOADI(n_) if(!(vk.n_ = (PFN_vk##n_)vk_icdGetInstanceProcAddr(inst, "vk" #n_))) return die("falta vk" #n_, VK_ERROR_INITIALIZATION_FAILED);
#define LOADD(n_) if(!(vk.n_ = (PFN_vk##n_)vk.GetDeviceProcAddr(dev, "vk" #n_))) return die("falta vk" #n_, VK_ERROR_INITIALIZATION_FAILED);
  if(!(vk.CreateInstance = (PFN_vkCreateInstance)vk_icdGetInstanceProcAddr(VK_NULL_HANDLE, "vkCreateInstance")))
    return die("vk_icdGetInstanceProcAddr", VK_ERROR_INITIALIZATION_FAILED);
  {
    static const char *ext[] = { VK_KHR_SURFACE_EXTENSION_NAME, VK_KHR_DISPLAY_EXTENSION_NAME };
    VkApplicationInfo app = { VK_STRUCTURE_TYPE_APPLICATION_INFO, NULL, "PokeSurvivor", 1, "PokeSurvivor", 1, VK_API_VERSION_1_3 };
    VkInstanceCreateInfo ci = { VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, NULL, 0, &app, 0, NULL, 2, ext };
    TRY(vk.CreateInstance(&ci, NULL, &inst), "vkCreateInstance");
  }
  VKI(LOADI)
  if(vk.EnumeratePhysicalDevices(inst, &n, &phys) < 0 || !n) return die("sin GPU", VK_ERROR_INITIALIZATION_FAILED);
  vk.GetPhysicalDeviceProperties(phys, &pp);
  vk.GetPhysicalDeviceMemoryProperties(phys, &memp);
  fprintf(stderr, "[gpu] Vulkan: %s, Vulkan %u.%u.%u\n", pp.deviceName, VK_API_VERSION_MAJOR(pp.apiVersion),
          VK_API_VERSION_MINOR(pp.apiVersion), VK_API_VERSION_PATCH(pp.apiVersion));
  n = 8;
  vk.GetPhysicalDeviceQueueFamilyProperties(phys, &n, qf);
  for(uint32_t i = 0; i < n && family == UINT32_MAX; i++) if(qf[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) family = i;
  if(family == UINT32_MAX) return die("sin cola de gráficos", VK_ERROR_INITIALIZATION_FAILED);
  if(open_display()) return -1;
  {
    static const char *ext[] = { VK_KHR_SWAPCHAIN_EXTENSION_NAME, VK_KHR_PUSH_DESCRIPTOR_EXTENSION_NAME };
    const float prio = 1;
    VkDeviceQueueCreateInfo qi = { VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO, NULL, 0, family, 1, &prio };
    VkPhysicalDeviceVulkan13Features f13 = { VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_3_FEATURES };
    VkDeviceCreateInfo ci = { VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO };
    f13.dynamicRendering = VK_TRUE;
    ci.pNext = &f13; ci.queueCreateInfoCount = 1; ci.pQueueCreateInfos = &qi;
    ci.enabledExtensionCount = 2; ci.ppEnabledExtensionNames = ext;
    TRY(vk.CreateDevice(phys, &ci, NULL, &dev), "vkCreateDevice");
  }
  VKD(LOADD)
#undef LOADI
#undef LOADD
  vk.GetDeviceQueue(dev, family, 0, &queue);
  {   // el stencil del recorte: S8 si se puede
    static const VkFormat cand[3] = { VK_FORMAT_S8_UINT, VK_FORMAT_D24_UNORM_S8_UINT, VK_FORMAT_D32_SFLOAT_S8_UINT };
    VkFormatProperties fp;
    st_fmt = VK_FORMAT_UNDEFINED;
    for(int i = 0; i < 3 && !st_fmt; i++) {
      vk.GetPhysicalDeviceFormatProperties(phys, cand[i], &fp);
      if(fp.optimalTilingFeatures & VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT) { st_fmt = cand[i]; st_depth = i > 0; }
    }
    if(!st_fmt) return die("sin formato de stencil", VK_ERROR_FORMAT_NOT_SUPPORTED);
  }
  if(make_image(&rt, W, H, RT_FMT, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT,
                VK_IMAGE_ASPECT_COLOR_BIT) ||
     make_image(&st, W, H, st_fmt, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT,
                VK_IMAGE_ASPECT_STENCIL_BIT | (st_depth ? VK_IMAGE_ASPECT_DEPTH_BIT : 0)))
    return die("la pantalla del juego", VK_ERROR_OUT_OF_DEVICE_MEMORY);
  {
    VkSampler smp;
    VkDescriptorSetLayout dsl;
    VkSamplerCreateInfo sc = { VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO };   // al píxel (pixel art, como gpu.c)
    sc.magFilter = sc.minFilter = VK_FILTER_NEAREST; sc.mipmapMode = VK_SAMPLER_MIPMAP_MODE_NEAREST;
    sc.addressModeU = sc.addressModeV = sc.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    TRY(vk.CreateSampler(dev, &sc, NULL, &smp), "vkCreateSampler");
    VkDescriptorSetLayoutBinding b = { 0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1, VK_SHADER_STAGE_FRAGMENT_BIT, &smp };
    VkDescriptorSetLayoutCreateInfo dc = { VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO, NULL,
                                           VK_DESCRIPTOR_SET_LAYOUT_CREATE_PUSH_DESCRIPTOR_BIT_KHR, 1, &b };
    TRY(vk.CreateDescriptorSetLayout(dev, &dc, NULL, &dsl), "vkCreateDescriptorSetLayout");
    VkPushConstantRange pc = { VK_SHADER_STAGE_VERTEX_BIT, 0, 8 };
    VkPipelineLayoutCreateInfo lc = { VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO, NULL, 0, 1, &dsl, 1, &pc };
    TRY(vk.CreatePipelineLayout(dev, &lc, NULL, &layout), "vkCreatePipelineLayout");
  }
  {
    const double t0 = ms_now();
    VkShaderModule vs = shader(gpu_vk_vert, sizeof gpu_vk_vert), fs = shader(gpu_vk_frag, sizeof gpu_vk_frag);
    if(!vs || !fs) return die("vkCreateShaderModule", VK_ERROR_INITIALIZATION_FAILED);
    for(int op = 0; op < 11; op++)
      for(int c = 0; c < 2; c++)
        if(!(pipes[op][c] = pipeline(vs, fs, op, c))) return die("vkCreateGraphicsPipelines", VK_ERROR_INITIALIZATION_FAILED);
    if(!(pipe_clipw = pipeline(vs, fs, 0, 2))) return die("vkCreateGraphicsPipelines (recorte)", VK_ERROR_INITIALIZATION_FAILED);
    fprintf(stderr, "[gpu] Vulkan: 23 pipelines en %.0f ms\n", ms_now() - t0);
  }
  {
    VkCommandPoolCreateInfo pc = { VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO, NULL, VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT, family };
    VkFenceCreateInfo fc = { VK_STRUCTURE_TYPE_FENCE_CREATE_INFO, NULL, VK_FENCE_CREATE_SIGNALED_BIT };
    VkSemaphoreCreateInfo sc = { VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO };
    TRY(vk.CreateCommandPool(dev, &pc, NULL, &pool), "vkCreateCommandPool");
    for(int i = 0; i < NF; i++) {
      VkCommandBuffer cbs[2];
      VkCommandBufferAllocateInfo ai_ = { VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO, NULL, pool, VK_COMMAND_BUFFER_LEVEL_PRIMARY, 2 };
      TRY(vk.AllocateCommandBuffers(dev, &ai_, cbs), "vkAllocateCommandBuffers");
      fr[i].pre = cbs[0]; fr[i].cmd = cbs[1];
      TRY(vk.CreateFence(dev, &fc, NULL, &fr[i].fence), "vkCreateFence");
      TRY(vk.CreateSemaphore(dev, &sc, NULL, &fr[i].acquired), "vkCreateSemaphore");
    }
  }
  if(open_swapchain(family)) return -1;
  F = &fr[0];
  recycle();
  begin_frame();
  {   // la pantalla del juego transparente al empezar (como un lienzo nuevo), el stencil a 0, y la textura blanca
    static const Uint32 one = 0xffffffff;
    const VkClearColorValue clear = { .float32 = { 0, 0, 0, 0 } };
    const VkImageSubresourceRange all = { VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 };
    to_general(F->pre, rt.img, VK_IMAGE_ASPECT_COLOR_BIT);
    to_general(F->pre, st.img, VK_IMAGE_ASPECT_STENCIL_BIT | (st_depth ? VK_IMAGE_ASPECT_DEPTH_BIT : 0));
    vk.CmdClearColorImage(F->pre, rt.img, VK_IMAGE_LAYOUT_GENERAL, &clear, 1, &all);
    if(!(white = gpu_upload(0, &one, 1, 1, 1))) return die("la textura blanca", VK_ERROR_OUT_OF_DEVICE_MEMORY);
  }
  fprintf(stderr, "[gpu] Vulkan: pantalla del juego %dx%d → %ux%u, %u imágenes en la cadena, stencil %d\n",
          W, H, sw_ext.width, sw_ext.height, n_sw, (int)st_fmt);
  gpu_on = 1;
  return 0;
}

int
gpu_open(struct SDL_Window *win, int w, int h) {
  char path[512];
  (void)win;
  snprintf(path, sizeof path, "%s/no-vulkan", plat_data());
  if(!access(path, F_OK)) { fprintf(stderr, "[gpu] Vulkan: apagado (%s); sigue PlutoVG\n", path); return -1; }
  fprintf(stderr, "[gpu] Vulkan: arrancando (si el título se cierra aquí, crea %s para volver a PlutoVG)\n", path);
  if(!open_all(w, h)) return 0;
  gpu_vk_close();
  return -1;
}
#endif
