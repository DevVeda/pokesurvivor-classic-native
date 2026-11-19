/* Instala el título "PokéSurvivor" (PKSV00001) en la pantalla de inicio de la PS5.
 * Es un título sin ejecutable: su param.json tiene deeplinkUri y la consola lo
 * abre como app web (sin barra de navegador), igual que el lanzador de websrv.
 * La página la sirve websrv (puerto 8080) desde /data/homebrew/PokeSurvivor.
 * Basado en install_launcher() de ps5-payload-dev/websrv (src/ps5/sys.c).
 * Se compila con tools/ps5/install/Makefile; ver tools/ps5/README.md.
 */
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include <ps5/kernel.h>

#ifndef START_URL
#define START_URL "http://127.0.0.1:8080/fs/data/homebrew/PokeSurvivor/probe.html"
#endif

#define TITLE_ID "PKSV00001"
#define APP_DIR  "/user/app/" TITLE_ID
#define ICON_SRC "/data/homebrew/PokeSurvivor/sce_sys/icon0.png"

typedef struct notify_request {
  char useless1[45];
  char message[3075];
} notify_request_t;

int sceKernelSendNotificationRequest(int, notify_request_t*, size_t, int);
int sceUserServiceInitialize(void*);
int sceAppInstUtilInitialize(void);
int sceAppInstUtilAppInstallAll(void*);

static void
notify(const char *msg) {
  notify_request_t req;
  memset(&req, 0, sizeof req);
  snprintf(req.message, sizeof req.message, "%s", msg);
  sceKernelSendNotificationRequest(0, &req, sizeof req, 0);
  puts(msg);
}

static int
copy_file(const char *src, const char *dst) {
  char buf[8192];
  size_t n;
  FILE *in = fopen(src, "rb"), *out;
  if(!in) return -1;
  if(!(out = fopen(dst, "wb"))) { fclose(in); return -1; }
  while((n = fread(buf, 1, sizeof buf, in)) > 0) fwrite(buf, 1, n, out);
  fclose(in);
  return fclose(out);
}

static int
install_app(const char *title_id, const char *dir) {
  int (*install_title_dir)(const char*, const char*, void*) = 0;
  uint32_t handle;

  if(!kernel_dynlib_handle(-1, "libSceAppInstUtil.sprx", &handle)) {
    install_title_dir = (void*)kernel_dynlib_resolve(-1, handle, "Wudg3Xe3heE");
  }
  if(install_title_dir) return install_title_dir(title_id, dir, 0);
  return sceAppInstUtilAppInstallAll(0);
}

int
main(void) {
  FILE *f;
  int err;

  sceUserServiceInitialize(0);
  kernel_set_ucred_authid(-1, 0x4801000000000013L);   // el mismo que usa websrv para instalar
  if((err = sceAppInstUtilInitialize())) {
    notify("PokeSurvivor: sceAppInstUtilInitialize ha fallado");
    return err;
  }

  if((mkdir(APP_DIR, 0755) && errno != EEXIST) || (mkdir(APP_DIR "/sce_sys", 0755) && errno != EEXIST)) {
    notify("PokeSurvivor: no se pudo crear " APP_DIR);
    return -1;
  }

  // Se reescribe siempre: volver a lanzar el instalador cambia la URL de inicio.
  if(!(f = fopen(APP_DIR "/sce_sys/param.json", "w"))) {
    notify("PokeSurvivor: no se pudo escribir param.json");
    return -1;
  }
  fprintf(f,
          "{\n"
          "    \"titleId\": \"" TITLE_ID "\",\n"
          "    \"deeplinkUri\": \"%s\",\n"
          "    \"localizedParameters\": {\n"
          "\t\"defaultLanguage\": \"en-US\",\n"
          "\t\"en-US\": {\n"
          "\t    \"titleName\": \"PokeSurvivor\"\n"
          "\t}\n"
          "    }\n"
          "}\n", START_URL);
  fclose(f);

  if(copy_file(ICON_SRC, APP_DIR "/sce_sys/icon0.png")) {
    notify("PokeSurvivor: falta " ICON_SRC);
    return -1;
  }

  if((err = install_app(TITLE_ID, "/user/app/"))) {
    char msg[96];
    snprintf(msg, sizeof msg, "PokeSurvivor: la instalacion ha fallado (0x%x)", err);
    notify(msg);
    return err;
  }

  notify("PokeSurvivor instalado: busca su icono en el inicio");
  return 0;
}
