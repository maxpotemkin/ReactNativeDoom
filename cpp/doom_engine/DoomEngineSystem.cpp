#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

extern "C" {
#include "d_ticcmd.h"
#include "doomtype.h"
#include "i_joystick.h"
#include "i_sound.h"
#include "i_system.h"
#include "m_config.h"
}

namespace {
struct ExitCallback {
  atexit_func_t func;
  boolean runOnError;
};

std::vector<ExitCallback>& exitCallbacks() {
  static std::vector<ExitCallback> callbacks;
  return callbacks;
}

void runExitCallbacks(boolean isError) {
  auto& callbacks = exitCallbacks();
  for (auto it = callbacks.rbegin(); it != callbacks.rend(); ++it) {
    if (it->func != nullptr && (!isError || it->runOnError)) {
      it->func();
    }
  }
}

void clampVolumeSeparation(int* volume, int* separation) {
  if (*volume < 0) {
    *volume = 0;
  } else if (*volume > 127) {
    *volume = 127;
  }

  if (*separation < 0) {
    *separation = 0;
  } else if (*separation > 254) {
    *separation = 254;
  }
}

void bindVariable(const char* name, void* location) {
  M_BindVariable(const_cast<char*>(name), location);
}

sound_module_t* g_soundModule = nullptr;
music_module_t* g_musicModule = nullptr;
char g_emptyMusicCommand[] = "";
int g_sndSbPort = 0;
int g_sndSbIrq = 0;
int g_sndSbDma = 0;
int g_sndMPort = 0;
} // namespace

extern "C" int snd_samplerate = 44100;
extern "C" int snd_cachesize = 64 * 1024 * 1024;
extern "C" int snd_maxslicetime_ms = 28;
extern "C" char* snd_musiccmd = g_emptyMusicCommand;
extern "C" int snd_musicdevice = SNDDEVICE_SB;
extern "C" int snd_sfxdevice = SNDDEVICE_SB;
extern "C" int use_libsamplerate;
extern "C" float libsamplerate_scale;

extern "C" void I_Init(void) {}

extern "C" byte* I_ZoneBase(int* size) {
  constexpr int defaultRamMiB = 6;
  *size = defaultRamMiB * 1024 * 1024;
  auto* zone = static_cast<byte*>(std::malloc(static_cast<size_t>(*size)));
  if (zone == nullptr) {
    I_Error(const_cast<char*>("Unable to allocate %i MiB of RAM for zone"), defaultRamMiB);
  }
  return zone;
}

extern "C" boolean I_ConsoleStdout(void) {
  return true;
}

extern "C" ticcmd_t* I_BaseTiccmd(void) {
  static ticcmd_t empty;
  std::memset(&empty, 0, sizeof(empty));
  return &empty;
}

extern "C" void I_Quit(void) {
  runExitCallbacks(false);
}

extern "C" void I_Error(char* error, ...) {
  char message[1024];
  va_list args;
  va_start(args, error);
  std::vsnprintf(message, sizeof(message), error, args);
  va_end(args);

  runExitCallbacks(true);
  std::fprintf(stderr, "Doom engine error: %s\n", message);
  throw std::runtime_error(message);
}

extern "C" void I_Tactile(int on, int off, int total) {
  (void)on;
  (void)off;
  (void)total;
}

extern "C" boolean I_GetMemoryValue(unsigned int offset, void* value, int size) {
  (void)offset;
  (void)value;
  (void)size;
  return false;
}

extern "C" void I_AtExit(atexit_func_t func, boolean runIfError) {
  exitCallbacks().push_back(ExitCallback{func, runIfError});
}

extern "C" void I_BindVariables(void) {}

extern "C" void I_PrintStartupBanner(char* gamedescription) {
  I_PrintDivider();
  I_PrintBanner(gamedescription);
  I_PrintDivider();
}

extern "C" void I_PrintBanner(char* text) {
  std::printf("==== %s ====\n", text == nullptr ? "" : text);
}

extern "C" void I_PrintDivider(void) {
  std::printf("----------------------------------------\n");
}

extern "C" void I_InitJoystick(void) {}
extern "C" void I_ShutdownJoystick(void) {}
extern "C" void I_UpdateJoystick(void) {}
extern "C" void I_BindJoystickVariables(void) {}

extern "C" void I_InitSound(boolean useSfxPrefix) {
  g_soundModule = &DG_sound_module;
  if (!g_soundModule->Init(useSfxPrefix)) {
    g_soundModule = nullptr;
  }
  g_musicModule = &DG_music_module;
}

extern "C" void I_ShutdownSound(void) {
  if (g_soundModule != nullptr) {
    g_soundModule->Shutdown();
    g_soundModule = nullptr;
  }
}

extern "C" int I_GetSfxLumpNum(sfxinfo_t* sfxinfo) {
  return g_soundModule == nullptr ? 0 : g_soundModule->GetSfxLumpNum(sfxinfo);
}

extern "C" void I_UpdateSound(void) {
  if (g_soundModule != nullptr) {
    g_soundModule->Update();
  }
  if (g_musicModule != nullptr && g_musicModule->Poll != nullptr) {
    g_musicModule->Poll();
  }
}

extern "C" void I_UpdateSoundParams(int channel, int volume, int separation) {
  if (g_soundModule == nullptr) {
    return;
  }

  clampVolumeSeparation(&volume, &separation);
  g_soundModule->UpdateSoundParams(channel, volume, separation);
}

extern "C" int I_StartSound(sfxinfo_t* sfxinfo, int channel, int volume, int separation) {
  if (g_soundModule == nullptr) {
    return 0;
  }

  clampVolumeSeparation(&volume, &separation);
  return g_soundModule->StartSound(sfxinfo, channel, volume, separation);
}

extern "C" void I_StopSound(int channel) {
  if (g_soundModule != nullptr) {
    g_soundModule->StopSound(channel);
  }
}

extern "C" boolean I_SoundIsPlaying(int channel) {
  return g_soundModule != nullptr && g_soundModule->SoundIsPlaying(channel);
}

extern "C" void I_PrecacheSounds(sfxinfo_t* sounds, int numSounds) {
  if (g_soundModule != nullptr && g_soundModule->CacheSounds != nullptr) {
    g_soundModule->CacheSounds(sounds, numSounds);
  }
}

extern "C" void I_InitMusic(void) {
  if (g_musicModule != nullptr && !g_musicModule->Init()) {
    g_musicModule = nullptr;
  }
}

extern "C" void I_ShutdownMusic(void) {
  if (g_musicModule != nullptr) {
    g_musicModule->Shutdown();
    g_musicModule = nullptr;
  }
}

extern "C" void I_SetMusicVolume(int volume) {
  if (g_musicModule != nullptr) {
    g_musicModule->SetMusicVolume(volume);
  }
}

extern "C" void I_PauseSong(void) {
  if (g_musicModule != nullptr) {
    g_musicModule->PauseMusic();
  }
}

extern "C" void I_ResumeSong(void) {
  if (g_musicModule != nullptr) {
    g_musicModule->ResumeMusic();
  }
}

extern "C" void* I_RegisterSong(void* data, int len) {
  return g_musicModule == nullptr ? nullptr : g_musicModule->RegisterSong(data, len);
}

extern "C" void I_UnRegisterSong(void* handle) {
  if (g_musicModule != nullptr) {
    g_musicModule->UnRegisterSong(handle);
  }
}

extern "C" void I_PlaySong(void* handle, boolean looping) {
  if (g_musicModule != nullptr) {
    g_musicModule->PlaySong(handle, looping);
  }
}

extern "C" void I_StopSong(void) {
  if (g_musicModule != nullptr) {
    g_musicModule->StopSong();
  }
}

extern "C" boolean I_MusicIsPlaying(void) {
  return g_musicModule != nullptr && g_musicModule->MusicIsPlaying();
}

extern "C" void I_BindSoundVariables(void) {
  bindVariable("snd_musicdevice", &snd_musicdevice);
  bindVariable("snd_sfxdevice", &snd_sfxdevice);
  bindVariable("snd_sbport", &g_sndSbPort);
  bindVariable("snd_sbirq", &g_sndSbIrq);
  bindVariable("snd_sbdma", &g_sndSbDma);
  bindVariable("snd_mport", &g_sndMPort);
  bindVariable("snd_maxslicetime_ms", &snd_maxslicetime_ms);
  bindVariable("snd_musiccmd", &snd_musiccmd);
  bindVariable("snd_samplerate", &snd_samplerate);
  bindVariable("snd_cachesize", &snd_cachesize);
  bindVariable("use_libsamplerate", &use_libsamplerate);
  bindVariable("libsamplerate_scale", &libsamplerate_scale);
}
