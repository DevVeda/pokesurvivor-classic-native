// gpu_vk.c: los cuadriláteros de la pantalla (x, y en píxeles; u, v; color premultiplicado). GPL-3.0-or-later
#version 450
layout(push_constant) uniform P { vec2 size; } pc;
layout(location = 0) in vec2 p;
layout(location = 1) in vec2 t;
layout(location = 2) in vec4 c;
layout(location = 0) out vec2 vt;
layout(location = 1) out vec4 vc;
void main() { vt = t; vc = c; gl_Position = vec4(p / pc.size * 2.0 - 1.0, 0.0, 1.0); }   // (en Vulkan, y = -1 es arriba)
