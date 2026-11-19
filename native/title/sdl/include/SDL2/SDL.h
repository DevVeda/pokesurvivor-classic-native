/* SDL.h del título — sólo lo que usan main.c y audio.c, hecho con las llamadas de la consola
 * (native/title/sdl/sdl_title.c): un título no puede cargar el SDL2 de los payloads (usa dlopen).
 * Mismos nombres y valores que SDL2, para que el código del payload compile igual.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
#pragma once
#include "SDL_stdinc.h"

#define SDL_INIT_AUDIO 0x10u
#define SDL_INIT_GAMECONTROLLER 0x2000u
int SDL_Init(Uint32 flags);
void SDL_Quit(void);
int SDL_SetError(const char *fmt, ...);
const char *SDL_GetError(void);
Uint64 SDL_GetPerformanceCounter(void);
Uint64 SDL_GetPerformanceFrequency(void);
Uint64 SDL_GetTicks64(void);
void SDL_Delay(Uint32 ms);

/* ---- eventos: sólo "mando conectado" (nunca SDL_QUIT: el título lo cierra la consola) ---- */
#define SDL_QUIT 0x100
#define SDL_CONTROLLERDEVICEADDED 0x653
typedef struct { Uint32 type; Uint32 timestamp; Sint32 which; } SDL_ControllerDeviceEvent;
typedef union { Uint32 type; SDL_ControllerDeviceEvent cdevice; Uint8 padding[56]; } SDL_Event;
int SDL_PollEvent(SDL_Event *ev);

/* ---- mando ---- */
typedef struct SDL_GameController SDL_GameController;
typedef enum {
  SDL_CONTROLLER_BUTTON_A, SDL_CONTROLLER_BUTTON_B, SDL_CONTROLLER_BUTTON_X, SDL_CONTROLLER_BUTTON_Y,
  SDL_CONTROLLER_BUTTON_BACK, SDL_CONTROLLER_BUTTON_GUIDE, SDL_CONTROLLER_BUTTON_START,
  SDL_CONTROLLER_BUTTON_LEFTSTICK, SDL_CONTROLLER_BUTTON_RIGHTSTICK,
  SDL_CONTROLLER_BUTTON_LEFTSHOULDER, SDL_CONTROLLER_BUTTON_RIGHTSHOULDER,
  SDL_CONTROLLER_BUTTON_DPAD_UP, SDL_CONTROLLER_BUTTON_DPAD_DOWN, SDL_CONTROLLER_BUTTON_DPAD_LEFT,
  SDL_CONTROLLER_BUTTON_DPAD_RIGHT, SDL_CONTROLLER_BUTTON_MISC1, SDL_CONTROLLER_BUTTON_PADDLE1,
  SDL_CONTROLLER_BUTTON_PADDLE2, SDL_CONTROLLER_BUTTON_PADDLE3, SDL_CONTROLLER_BUTTON_PADDLE4,
  SDL_CONTROLLER_BUTTON_TOUCHPAD, SDL_CONTROLLER_BUTTON_MAX
} SDL_GameControllerButton;
typedef enum {
  SDL_CONTROLLER_AXIS_LEFTX, SDL_CONTROLLER_AXIS_LEFTY, SDL_CONTROLLER_AXIS_RIGHTX, SDL_CONTROLLER_AXIS_RIGHTY,
  SDL_CONTROLLER_AXIS_TRIGGERLEFT, SDL_CONTROLLER_AXIS_TRIGGERRIGHT
} SDL_GameControllerAxis;
int SDL_NumJoysticks(void);
SDL_bool SDL_IsGameController(int index);
SDL_GameController *SDL_GameControllerOpen(int index);
Uint8 SDL_GameControllerGetButton(SDL_GameController *pad, SDL_GameControllerButton b);
Sint16 SDL_GameControllerGetAxis(SDL_GameController *pad, SDL_GameControllerAxis a);
int SDL_GameControllerRumble(SDL_GameController *pad, Uint16 lo, Uint16 hi, Uint32 ms);
const char *SDL_GameControllerName(SDL_GameController *pad);

/* ---- sonido: un hilo con sceAudioOut, 48 kHz estéreo; el callback rellena float ---- */
typedef Uint32 SDL_AudioDeviceID;
typedef void (*SDL_AudioCallback)(void *user, Uint8 *stream, int len);
#define AUDIO_F32SYS 0x8120
typedef struct { int freq; Uint16 format; Uint8 channels, silence; Uint16 samples, padding; Uint32 size;
                 SDL_AudioCallback callback; void *userdata; } SDL_AudioSpec;
SDL_AudioDeviceID SDL_OpenAudioDevice(const char *name, int capture, const SDL_AudioSpec *want, SDL_AudioSpec *have, int changes);
void SDL_PauseAudioDevice(SDL_AudioDeviceID dev, int pause);
void SDL_LockAudioDevice(SDL_AudioDeviceID dev);
void SDL_UnlockAudioDevice(SDL_AudioDeviceID dev);
