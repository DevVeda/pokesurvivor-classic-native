// gpu_vk.c: textura (B8G8R8A8, como PlutoVG: sin dar la vuelta a los canales) por el color. GPL-3.0-or-later
#version 450
layout(set = 0, binding = 0) uniform sampler2D tx;
layout(location = 0) in vec2 vt;
layout(location = 1) in vec4 vc;
layout(location = 0) out vec4 o;
// (r < 0: silueta, sólo la transparencia de la textura, en blanco: el destello de los golpes, gpu.h)
void main() { vec4 x = texture(tx, vt); if(vc.r < 0.0) x = vec4(x.a); o = x * abs(vc); }
