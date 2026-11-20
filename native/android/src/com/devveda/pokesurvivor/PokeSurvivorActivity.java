/* PokéSurvivor en Android: la actividad de SDL2 con lo que platform/android.c le pide por JNI (desde el hilo del juego).
 * Sin Gradle: tools/package-android.sh la compila con javac y d8 junto a las clases de SDL.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
package com.devveda.pokesurvivor;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.libsdl.app.SDLActivity;

public class PokeSurvivorActivity extends SDLActivity {
  private static final String TAG = "PokeSurvivor";
  private static final int PICK = 7401;

  /** Toda la pantalla, también junto a la cámara (si no, Android deja ahí una banda negra en horizontal). */
  @Override
  protected void onCreate(Bundle b) {
    super.onCreate(b);
    if (android.os.Build.VERSION.SDK_INT >= 28)
      getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
  }

  /** Sin barras del sistema (hora, batería, navegación) cada vez que el juego vuelve a tener el foco: SDL sólo las quita al
   *  crear la ventana, y tras el navegador o el selector de archivos volvían a tapar la barra de arriba. */
  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (!hasFocus) return;
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  }

  /** «Atrás» con el gesto (y el botón si la superficie no tiene el foco) llega aquí y no como tecla; con
   *  SDL_ANDROID_TRAP_BACK_BUTTON, SDL no hacía nada. Se le da al juego como la tecla atrás (AC Back = Esc en ui.js). */
  @Override
  public void onBackPressed() {
    SDLActivity.onNativeKeyDown(KeyEvent.KEYCODE_BACK);
    SDLActivity.onNativeKeyUp(KeyEvent.KEYCODE_BACK);
  }

  /** Los archivos del juego (plat_root): van en el APK (assets/ps/) y se copian una vez por instalación a files/game,
   *  porque el C los lee con fopen. La marca es la hora de la instalación: cada APK nuevo los vuelve a copiar. */
  // @step android/prep event "prepareGame"
  // Al abrir, si cambió lastUpdateTime, copia assets/ps a files/game.
  public String prepareGame() {
    File root = new File(getFilesDir(), "game"), mark = new File(root, ".stamp");
    try {
      String stamp = String.valueOf(getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime);
      if (stamp.equals(read(mark))) return root.getPath();
      runOnUiThread(() -> Toast.makeText(this, "PokéSurvivor Classic Native…", Toast.LENGTH_LONG).show());
      rm(root);
      byte[] buf = new byte[1 << 16];
      try (ZipFile z = new ZipFile(getApplicationInfo().sourceDir)) {
        for (Enumeration<? extends ZipEntry> en = z.entries(); en.hasMoreElements(); ) {
          ZipEntry e = en.nextElement();
          String n = e.getName();
          if (e.isDirectory() || !n.startsWith("assets/ps/") || n.contains("..")) continue;
          File f = new File(root, n.substring(10));
          f.getParentFile().mkdirs();
          try (InputStream in = z.getInputStream(e); OutputStream out = new FileOutputStream(f)) {
            for (int k; (k = in.read(buf)) > 0; ) out.write(buf, 0, k);
          }
        }
      }
      try (OutputStream out = new FileOutputStream(mark)) { out.write(stamp.getBytes(StandardCharsets.UTF_8)); }
    } catch (Exception ex) {
      Log.e(TAG, "no se pudo preparar el juego", ex);
    }
    return root.getPath();
  }

  /** ps.pick_file: el selector de archivos del sistema; lo elegido llega como un archivo arrastrado (SDL_DROPFILE). */
  public void pickFile() {
    runOnUiThread(() -> {
      try {
        startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), PICK);
      } catch (Exception e) { Log.e(TAG, "sin selector de archivos", e); }
    });
  }

  @Override
  protected void onActivityResult(int req, int res, Intent data) {
    super.onActivityResult(req, res, data);
    if (req != PICK) return;
    // (cancelado: un archivo vacío, «nada»; si no, ui.js se quedaba en «Esperando el archivo…»)
    if (res != RESULT_OK || data == null || data.getData() == null) { onNativeDropFile(""); return; }
    File f = new File(getCacheDir(), "import.json");
    byte[] buf = new byte[1 << 16];
    long total = 0;
    try (InputStream in = getContentResolver().openInputStream(data.getData()); OutputStream out = new FileOutputStream(f)) {
      for (int k; (k = in.read(buf)) > 0 && (total += k) < (64 << 20); ) out.write(buf, 0, k);   // (una partida: unos KB)
    } catch (Exception e) { Log.e(TAG, "no se pudo leer el archivo", e); onNativeDropFile(""); return; }
    onNativeDropFile(f.getPath());
  }

  /** ps.relaunch: el proceso entero de nuevo (la resolución, una actualización). Restart, en otro proceso, cierra éste y
   *  vuelve a abrir el juego; main.c sale después de llamar aquí. */
  public void relaunch() {
    startActivity(new Intent(this, Restart.class).putExtra("pid", android.os.Process.myPid()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  }

  /** plat_keep_alive (net.c): mientras se espera la vuelta de Google a 127.0.0.1, un servicio en primer plano para que
   *  Android no congele el proceso con el juego en segundo plano (GrapheneOS lo congela al momento y el navegador se quedaba
   *  en «Continuar»). Se enciende con el juego delante (Android 12+ no deja hacerlo desde segundo plano). */
  public void keepAlive(boolean on) {
    Intent i = new Intent(this, Wait.class);
    try {
      if (!on) stopService(i);
      else if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
      else startService(i);
    } catch (Exception e) { Log.e(TAG, "keepAlive " + on, e); }
  }

  public static class Wait extends Service {
    @Override
    public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent i, int flags, int id) {
      Notification.Builder b;
      if (Build.VERSION.SDK_INT >= 26) {
        getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel("login", "Google", NotificationManager.IMPORTANCE_LOW));
        b = new Notification.Builder(this, "login");
      } else b = new Notification.Builder(this);
      // (icono del sistema: el del juego es adaptativo y en la barra de notificaciones no vale)
      Notification n = b.setSmallIcon(android.R.drawable.ic_popup_sync).setContentTitle("PokéSurvivor Classic Native")
          .setContentText("Google…").setOngoing(true).build();
      if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
      else startForeground(1, n);
      return START_NOT_STICKY;
    }
  }

  public static class Restart extends Activity {
    @Override
    protected void onCreate(Bundle b) {
      super.onCreate(b);
      int pid = getIntent().getIntExtra("pid", -1);
      if (pid > 0) android.os.Process.killProcess(pid);
      Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
      if (i != null) startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
      finish();
      Runtime.getRuntime().exit(0);
    }
  }

  private static String read(File f) {
    try (InputStream in = new FileInputStream(f)) {
      byte[] b = new byte[64];
      int n = in.read(b);
      return n > 0 ? new String(b, 0, n, StandardCharsets.UTF_8) : "";
    } catch (Exception e) { return ""; }
  }

  private static void rm(File f) {
    File[] kids = f.listFiles();
    if (kids != null) for (File k : kids) rm(k);
    f.delete();
  }
}
