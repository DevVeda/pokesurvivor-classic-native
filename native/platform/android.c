/* Android (ver platform.h): la ventana, el mando y el idioma son los de platform/sdl.c (con su parte #ifdef __ANDROID__);
 * aquí lo que pide a la actividad Java (native/android/src/…/PokeSurvivorActivity.java) por JNI: los archivos del juego,
 * reabrir, el teclado del sistema y el selector de archivos.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <sys/stat.h>
#include <jni.h>
#include <SDL2/SDL.h>
#include "platform.h"

const char PLAT_NAME[] = "android";

// Un método de la actividad (desde el hilo del juego: SDL ya lo tiene unido a la JVM). Devuelve lo que dé o NULL.
static jobject
call(const char *name, const char *sig, ...) {
  JNIEnv *e = (JNIEnv*)SDL_AndroidGetJNIEnv();
  jobject act = (jobject)SDL_AndroidGetActivity(), r = NULL;
  if(!e || !act) return NULL;
  jclass c = (*e)->GetObjectClass(e, act);
  jmethodID m = (*e)->GetMethodID(e, c, name, sig);
  if(m) {
    va_list ap;
    va_start(ap, sig);
    if(sig[strlen(sig) - 1] == 'V') (*e)->CallVoidMethodV(e, act, m, ap);
    else r = (*e)->CallObjectMethodV(e, act, m, ap);
    va_end(ap);
  }
  if((*e)->ExceptionCheck(e)) { (*e)->ExceptionDescribe(e); (*e)->ExceptionClear(e); r = NULL; }
  (*e)->DeleteLocalRef(e, c);
  (*e)->DeleteLocalRef(e, act);
  return r;
}

// Un String de Java a out (y suelta la referencia). 0 si era null.
static int
str(jobject s, char *out, size_t n) {
  JNIEnv *e = (JNIEnv*)SDL_AndroidGetJNIEnv();
  if(!s) return 0;
  const char *u = (*e)->GetStringUTFChars(e, (jstring)s, NULL);
  snprintf(out, n, "%s", u ? u : "");
  if(u) (*e)->ReleaseStringUTFChars(e, (jstring)s, u);
  (*e)->DeleteLocalRef(e, s);
  return 1;
}

// Los archivos del juego: van en el APK y la actividad los copia a files/game la primera vez de cada instalación
// (el C los lee con fopen). Esa primera vez tarda unos segundos (pantalla negra con un aviso).
const char*
plat_root(void) {
  static char p[1024];
  if(!*p && !str(call("prepareGame", "()Ljava/lang/String;"), p, sizeof p)) snprintf(p, sizeof p, ".");
  return p;
}

// Donde se escribe: la carpeta externa de la app (/sdcard/Android/data/<paquete>/files: log.txt se lee con adb, just
// android-log) o, si no hay, la interna. Las dos son sólo de esta app y se borran al desinstalarla.
const char*
plat_data(void) {
  static char p[1024];
  if(*p) return p;
  const char *ext = SDL_AndroidGetExternalStorageState() & SDL_ANDROID_EXTERNAL_STORAGE_WRITE ? SDL_AndroidGetExternalStoragePath() : NULL;
  const char *in = SDL_AndroidGetInternalStoragePath();
  snprintf(p, sizeof p, "%s", ext ? ext : in ? in : ".");
  mkdir(p, 0755);
  return p;
}

// Otro proceso cierra éste y vuelve a abrir el juego (PokeSurvivorActivity.Restart); main.c sale justo después.
void
plat_relaunch(char **argv) {
  (void)argv;
  call("relaunch", "()V");
}

// Sin cuadro del sistema: ui.js escribe en sus propios campos con el teclado de la pantalla (ps.text_mode).
int
plat_text_input(const char *title, const char *init, int max, int mask, char *out, size_t n) {
  (void)title; (void)init; (void)max; (void)mask; (void)out; (void)n;
  return -1;
}

int
plat_pick_file(void) {
  call("pickFile", "()V");
  return 1;
}

// Con el juego en segundo plano Android puede congelar el proceso entero (GrapheneOS, al momento): el hilo de net.c no
// contestaba a 127.0.0.1 y el navegador se quedaba en «Continuar» de Google. Un servicio en primer plano lo impide.
// (Se enciende con el juego delante, como pide Android 12+; se apaga desde el hilo de net.c: SDL lo une a la JVM.)
void
plat_keep_alive(int on) {
  call("keepAlive", "(Z)V", (jboolean)(on ? JNI_TRUE : JNI_FALSE));
}
