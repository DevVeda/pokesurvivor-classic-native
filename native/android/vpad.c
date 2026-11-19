/* Mandos virtuales para probar el cooperativo local en el emulador de Android (just android-pads): crea N mandos
 * «Xbox 360» por uinput (Android y SDL los ven como mandos USB de verdad) y lee órdenes de un archivo (una FIFO):
 *   <mando> <botón> <0|1>      botones: a b x y lb rb back start      (ej.: "2 a 1", "2 a 0")
 *   <mando> <eje> <-1..1>      ejes: lx ly rx ry                      (ej.: "2 lx 1", "2 lx 0")
 *   <mando> off                lo desconecta
 * Uso (en el emulador, con adb root): vpad 2 /data/local/tmp/vpad.in
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <fcntl.h>
#include <linux/uinput.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

static int fd[8];

static void
emit(int f, int type, int code, int val) {
  struct input_event e;
  memset(&e, 0, sizeof e);
  e.type = type; e.code = code; e.value = val;
  write(f, &e, sizeof e);
  e.type = EV_SYN; e.code = SYN_REPORT; e.value = 0;
  write(f, &e, sizeof e);
}

static int
mk(int n) {
  static const int keys[] = { BTN_A, BTN_B, BTN_X, BTN_Y, BTN_TL, BTN_TR, BTN_SELECT, BTN_START, BTN_MODE, BTN_THUMBL, BTN_THUMBR };
  static const int axes[] = { ABS_X, ABS_Y, ABS_RX, ABS_RY, ABS_Z, ABS_RZ, ABS_HAT0X, ABS_HAT0Y };
  struct uinput_user_dev u;
  int f = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
  if(f < 0) { perror("/dev/uinput"); exit(1); }
  ioctl(f, UI_SET_EVBIT, EV_KEY); ioctl(f, UI_SET_EVBIT, EV_ABS); ioctl(f, UI_SET_EVBIT, EV_SYN);
  for(size_t i = 0; i < sizeof keys / sizeof *keys; i++) ioctl(f, UI_SET_KEYBIT, keys[i]);
  memset(&u, 0, sizeof u);
  snprintf(u.name, sizeof u.name, "Virtual Xbox 360 Pad %d", n);
  u.id.bustype = BUS_USB; u.id.vendor = 0x045e; u.id.product = 0x028e; u.id.version = 0x110 + n;
  for(size_t i = 0; i < sizeof axes / sizeof *axes; i++) {
    const int a = axes[i];
    ioctl(f, UI_SET_ABSBIT, a);
    if(a == ABS_Z || a == ABS_RZ) { u.absmin[a] = 0; u.absmax[a] = 255; }
    else if(a == ABS_HAT0X || a == ABS_HAT0Y) { u.absmin[a] = -1; u.absmax[a] = 1; }
    else { u.absmin[a] = -32768; u.absmax[a] = 32767; u.absflat[a] = 128; }
  }
  write(f, &u, sizeof u);
  if(ioctl(f, UI_DEV_CREATE) < 0) { perror("UI_DEV_CREATE"); exit(1); }
  return f;
}

int
main(int argc, char **argv) {
  const int n = argc > 1 ? atoi(argv[1]) : 2;
  const char *in = argc > 2 ? argv[2] : "/data/local/tmp/vpad.in";
  static const struct { const char *k; int code; } B[] = { { "a", BTN_A }, { "b", BTN_B }, { "x", BTN_X }, { "y", BTN_Y },
    { "lb", BTN_TL }, { "rb", BTN_TR }, { "back", BTN_SELECT }, { "start", BTN_START } };
  static const struct { const char *k; int code; } A[] = { { "lx", ABS_X }, { "ly", ABS_Y }, { "rx", ABS_RX }, { "ry", ABS_RY } };
  char line[128], cmd[16];
  for(int i = 1; i <= n && i < 8; i++) { fd[i] = mk(i); usleep(300000); }
  printf("vpad: %d mandos; órdenes en %s\n", n, in);
  fflush(stdout);
  for(;;) {
    FILE *f = fopen(in, "r");   // (una FIFO: espera a que alguien escriba; al cerrarse, se vuelve a abrir)
    if(!f) { sleep(1); continue; }
    while(fgets(line, sizeof line, f)) {
      int p = 0; float v = 0;
      if(sscanf(line, "%d %15s %f", &p, cmd, &v) < 2 || p < 1 || p > n || p >= 8 || fd[p] < 0) continue;
      if(!strcmp(cmd, "off")) { ioctl(fd[p], UI_DEV_DESTROY); close(fd[p]); fd[p] = -1; continue; }
      for(size_t i = 0; i < sizeof B / sizeof *B; i++) if(!strcmp(cmd, B[i].k)) emit(fd[p], EV_KEY, B[i].code, v != 0);
      for(size_t i = 0; i < sizeof A / sizeof *A; i++) if(!strcmp(cmd, A[i].k)) emit(fd[p], EV_ABS, A[i].code, (int)(v * 32767));
    }
    fclose(f);
  }
}
