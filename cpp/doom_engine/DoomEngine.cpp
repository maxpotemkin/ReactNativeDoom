#include "DoomEngine.hpp"

#include <NitroModules/HybridObjectRegistry.hpp>
#include <NitroModules/Prototype.hpp>
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <thread>

extern "C" {
#include "doomgeneric.h"
#include "doomkeys.h"
#include "i_sound.h"
#include "sounds.h"
#include "w_wad.h"
#include "z_zone.h"
}

namespace reactnativedoom {

namespace {
DoomEngine* g_engine = nullptr;
const auto g_startTime = std::chrono::steady_clock::now();
constexpr uint32_t AUDIO_PACKET_MAGIC = 0x58414d44; // DMAX
constexpr size_t AUDIO_PACKET_HEADER_BYTES = 8;
constexpr size_t AUDIO_EVENT_HEADER_BYTES = 24;

uint32_t getTicksMs() {
  const auto now = std::chrono::steady_clock::now();
  return static_cast<uint32_t>(
    std::chrono::duration_cast<std::chrono::milliseconds>(now - g_startTime).count()
  );
}

template <typename T>
void writeValue(uint8_t*& cursor, T value) {
  std::memcpy(cursor, &value, sizeof(T));
  cursor += sizeof(T);
}

} // namespace

DoomEngine::DoomEngine() : HybridObject(TAG) {}

std::string DoomEngine::getDefaultIWadPath() {
  return findBundledIWadPath();
}

std::string DoomEngine::getLoadedIWadPath() {
  std::lock_guard<std::mutex> lock(mutex_);
  return loadedIWadPath_;
}

std::string DoomEngine::getLastStatus() {
  std::lock_guard<std::mutex> lock(mutex_);
  return lastStatus_;
}

std::string DoomEngine::getWindowTitle() {
  std::lock_guard<std::mutex> lock(mutex_);
  return windowTitle_;
}

double DoomEngine::getWidth() {
  return WIDTH;
}

double DoomEngine::getHeight() {
  return HEIGHT;
}

double DoomEngine::getFrameCount() {
  std::lock_guard<std::mutex> lock(mutex_);
  return frameCount_;
}

bool DoomEngine::getIsStarted() {
  std::lock_guard<std::mutex> lock(mutex_);
  return started_;
}

std::string DoomEngine::start(const std::string& iwadPath) {
  if (iwadPath.empty()) {
    throw std::invalid_argument("DoomEngine.start expected a non-empty IWAD path.");
  }

  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (started_) {
      return lastStatus_;
    }
    started_ = true;
    loadedIWadPath_ = iwadPath;
    lastStatus_ = "loading IWAD: " + iwadPath;
  }

  g_engine = this;
  argvStorage_ = {
    "doomgeneric",
    "-iwad",
    iwadPath,
    "-nomusic",
    "-window",
    "-gfxmode",
    "rgba8888",
  };
  argv_.clear();
  argv_.reserve(argvStorage_.size());
  for (std::string& arg : argvStorage_) {
    argv_.push_back(arg.data());
  }

  doomgeneric_Create(static_cast<int>(argv_.size()), argv_.data());

  {
    std::lock_guard<std::mutex> lock(mutex_);
    lastStatus_ = "loaded IWAD: " + iwadPath;
  }

  return getLastStatus();
}

bool DoomEngine::tick() {
  if (!getIsStarted()) {
    return false;
  }

  g_engine = this;
  doomgeneric_Tick();
  return true;
}

std::shared_ptr<margelo::nitro::ArrayBuffer> DoomEngine::tickAndGetFrame() {
  tick();
  return copyFrameAsRgba();
}

std::shared_ptr<margelo::nitro::ArrayBuffer> DoomEngine::tickAndGetFrameAudio() {
  tick();

  std::deque<AudioEvent> events;
  {
    std::lock_guard<std::mutex> lock(audioMutex_);
    events.swap(audioEvents_);
  }

  size_t totalSize = AUDIO_PACKET_HEADER_BYTES + FRAME_BYTES + sizeof(uint32_t);
  for (const auto& event : events) {
    totalSize += AUDIO_EVENT_HEADER_BYTES + event.samples.size() * sizeof(float);
  }

  auto packet = margelo::nitro::ArrayBuffer::allocate(totalSize);
  auto* cursor = packet->data();

  writeValue<uint32_t>(cursor, AUDIO_PACKET_MAGIC);
  writeValue<uint32_t>(cursor, static_cast<uint32_t>(FRAME_BYTES));
  writeFrameAsRgba(cursor);
  cursor += FRAME_BYTES;
  writeValue<uint32_t>(cursor, static_cast<uint32_t>(events.size()));

  for (const auto& event : events) {
    writeValue<int32_t>(cursor, event.sfxId);
    writeValue<int32_t>(cursor, event.channel);
    writeValue<int32_t>(cursor, event.sampleRate);
    writeValue<int32_t>(cursor, static_cast<int32_t>(event.samples.size()));
    writeValue<float>(cursor, event.volume);
    writeValue<float>(cursor, event.pan);

    const size_t sampleBytes = event.samples.size() * sizeof(float);
    if (sampleBytes > 0) {
      std::memcpy(cursor, event.samples.data(), sampleBytes);
      cursor += sampleBytes;
    }
  }

  return packet;
}

void DoomEngine::openMenu() {
  pushKey(true, KEY_ESCAPE);
  pushKey(false, KEY_ESCAPE);
}

void DoomEngine::queueKey(const std::string& key, bool pressed) {
  pushKey(pressed, mapKey(key));
}

std::shared_ptr<margelo::nitro::ArrayBuffer> DoomEngine::getFrame() {
  return copyFrameAsRgba();
}

void DoomEngine::onDrawFrame() {
  std::lock_guard<std::mutex> lock(mutex_);
  frameCount_ += 1;
}

void DoomEngine::enqueueAudioEvent(
  int sfxId,
  int channel,
  int sampleRate,
  float volume,
  float pan,
  std::vector<float>&& samples
) {
  if (sampleRate <= 0 || samples.empty()) {
    return;
  }

  std::lock_guard<std::mutex> lock(audioMutex_);
  if (audioEvents_.size() >= MAX_AUDIO_EVENTS) {
    audioEvents_.pop_front();
  }

  audioEvents_.push_back(AudioEvent{
    sfxId,
    channel,
    sampleRate,
    std::clamp(volume, 0.0f, 1.0f),
    std::clamp(pan, -1.0f, 1.0f),
    std::move(samples),
  });
}

int DoomEngine::pollKey(int* pressed, unsigned char* key) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (keyQueue_.empty()) {
    return 0;
  }

  unsigned short keyData = keyQueue_.front();
  keyQueue_.pop_front();
  *pressed = keyData >> 8;
  *key = keyData & 0xff;
  return 1;
}

void DoomEngine::setWindowTitle(const char* title) {
  std::lock_guard<std::mutex> lock(mutex_);
  windowTitle_ = title == nullptr ? "" : title;
}

void DoomEngine::loadHybridMethods() {
  HybridObject::loadHybridMethods();
  registerHybrids(this, [](margelo::nitro::Prototype& prototype) {
    prototype.registerHybridGetter("defaultIWadPath", &DoomEngine::getDefaultIWadPath);
    prototype.registerHybridGetter("loadedIWadPath", &DoomEngine::getLoadedIWadPath);
    prototype.registerHybridGetter("lastStatus", &DoomEngine::getLastStatus);
    prototype.registerHybridGetter("windowTitle", &DoomEngine::getWindowTitle);
    prototype.registerHybridGetter("width", &DoomEngine::getWidth);
    prototype.registerHybridGetter("height", &DoomEngine::getHeight);
    prototype.registerHybridGetter("frameCount", &DoomEngine::getFrameCount);
    prototype.registerHybridGetter("isStarted", &DoomEngine::getIsStarted);
    prototype.registerHybridMethod("start", &DoomEngine::start);
    prototype.registerHybridMethod("tick", &DoomEngine::tick);
    prototype.registerHybridMethod("tickAndGetFrame", &DoomEngine::tickAndGetFrame);
    prototype.registerHybridMethod("tickAndGetFrameAudio", &DoomEngine::tickAndGetFrameAudio);
    prototype.registerHybridMethod("openMenu", &DoomEngine::openMenu);
    prototype.registerHybridMethod("queueKey", &DoomEngine::queueKey);
    prototype.registerHybridMethod("getFrame", &DoomEngine::getFrame);
  });
}

size_t DoomEngine::getExternalMemorySize() noexcept {
  return FRAME_BYTES;
}

void DoomEngine::pushKey(bool pressed, unsigned char key) {
  std::lock_guard<std::mutex> lock(mutex_);
  keyQueue_.push_back((static_cast<unsigned short>(pressed ? 1 : 0) << 8) | key);
}

unsigned char DoomEngine::mapKey(const std::string& key) const {
  if (key == "up") return KEY_UPARROW;
  if (key == "down") return KEY_DOWNARROW;
  if (key == "left") return KEY_LEFTARROW;
  if (key == "right") return KEY_RIGHTARROW;
  if (key == "strafe-left") return KEY_STRAFE_L;
  if (key == "strafe-right") return KEY_STRAFE_R;
  if (key == "fire") return KEY_FIRE;
  if (key == "use") return KEY_USE;
  if (key == "enter") return KEY_ENTER;
  if (key == "escape") return KEY_ESCAPE;
  if (key == "tab") return KEY_TAB;
  if (key == "shift") return KEY_RSHIFT;
  if (key == "strafe") return KEY_LALT;
  if (key.size() == 1) return static_cast<unsigned char>(key[0]);
  throw std::invalid_argument("Unknown Doom key: " + key);
}

std::shared_ptr<margelo::nitro::ArrayBuffer> DoomEngine::copyFrameAsRgba() {
  auto rgba = margelo::nitro::ArrayBuffer::allocate(FRAME_BYTES);
  writeFrameAsRgba(rgba->data());
  return rgba;
}

void DoomEngine::writeFrameAsRgba(uint8_t* output) {
  if (DG_ScreenBuffer == nullptr) {
    std::memset(output, 0, FRAME_BYTES);
    return;
  }

  auto* pixels = reinterpret_cast<const uint32_t*>(DG_ScreenBuffer);
  for (size_t i = 0; i < WIDTH * HEIGHT; ++i) {
    const uint32_t pixel = pixels[i];
    output[i * 4 + 0] = static_cast<unsigned char>((pixel >> 16) & 0xff);
    output[i * 4 + 1] = static_cast<unsigned char>((pixel >> 8) & 0xff);
    output[i * 4 + 2] = static_cast<unsigned char>(pixel & 0xff);
    output[i * 4 + 3] = 0xff;
  }
}

void registerDoomEngineHybridObject() {
  margelo::nitro::HybridObjectRegistry::registerHybridObjectConstructor(
    "DoomEngine",
    []() -> std::shared_ptr<margelo::nitro::HybridObject> {
      return std::make_shared<DoomEngine>();
    }
  );
}

DoomEngine* currentDoomEngine() {
  return g_engine;
}

} // namespace reactnativedoom

extern "C" void DG_Init() {}

extern "C" void DG_DrawFrame() {
  if (auto* engine = reactnativedoom::currentDoomEngine()) {
    engine->onDrawFrame();
  }
}

extern "C" void DG_SleepMs(uint32_t ms) {
  std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}

extern "C" uint32_t DG_GetTicksMs() {
  return reactnativedoom::getTicksMs();
}

extern "C" int DG_GetKey(int* pressed, unsigned char* key) {
  if (auto* engine = reactnativedoom::currentDoomEngine()) {
    return engine->pollKey(pressed, key);
  }
  return 0;
}

extern "C" void DG_SetWindowTitle(const char* title) {
  if (auto* engine = reactnativedoom::currentDoomEngine()) {
    engine->setWindowTitle(title);
  }
}

namespace {
boolean g_useSfxPrefix = true;

snddevice_t g_soundDevices[] = {
  SNDDEVICE_SB,
  SNDDEVICE_PAS,
  SNDDEVICE_GUS,
  SNDDEVICE_WAVEBLASTER,
  SNDDEVICE_SOUNDCANVAS,
  SNDDEVICE_AWE32,
};

constexpr int g_soundDeviceCount =
  static_cast<int>(sizeof(g_soundDevices) / sizeof(g_soundDevices[0]));

sfxinfo_t* linkedSfx(sfxinfo_t* sfxinfo) {
  if (sfxinfo == nullptr) {
    return nullptr;
  }
  return sfxinfo->link == nullptr ? sfxinfo : sfxinfo->link;
}

int sfxIdForInfo(sfxinfo_t* sfxinfo) {
  if (sfxinfo == nullptr) {
    return 0;
  }

  const ptrdiff_t offset = sfxinfo - S_sfx;
  if (offset > 0 && offset < NUMSFX) {
    return static_cast<int>(offset);
  }

  return 0;
}

void getSfxLumpName(sfxinfo_t* sfxinfo, char* buffer, size_t bufferSize) {
  auto* sfx = linkedSfx(sfxinfo);
  if (sfx == nullptr || bufferSize == 0) {
    return;
  }

  if (g_useSfxPrefix) {
    std::snprintf(buffer, bufferSize, "ds%s", sfx->name);
  } else {
    std::snprintf(buffer, bufferSize, "%s", sfx->name);
  }
}

boolean DG_InitSound(boolean useSfxPrefix) {
  g_useSfxPrefix = useSfxPrefix;
  return true;
}

void DG_ShutdownSound() {}

int DG_GetSfxLumpNum(sfxinfo_t* sfxinfo) {
  char nameBuffer[9] = {};
  getSfxLumpName(sfxinfo, nameBuffer, sizeof(nameBuffer));
  if (nameBuffer[0] == '\0') {
    return -1;
  }

  return W_CheckNumForName(nameBuffer);
}

void DG_UpdateSound() {}

void DG_UpdateSoundParams(int channel, int vol, int sep) {
  (void)channel;
  (void)vol;
  (void)sep;
}

bool decodeDoomSfx(sfxinfo_t* sfxinfo, int& sampleRate, std::vector<float>& samples) {
  int lumpNum = sfxinfo == nullptr ? -1 : sfxinfo->lumpnum;
  if (lumpNum < 0) {
    lumpNum = DG_GetSfxLumpNum(sfxinfo);
  }
  if (lumpNum < 0) {
    return false;
  }

  const int lumpLength = W_LumpLength(static_cast<unsigned int>(lumpNum));
  if (lumpLength < 32) {
    return false;
  }

  auto* data = static_cast<byte*>(W_CacheLumpNum(lumpNum, PU_STATIC));
  if (data == nullptr) {
    return false;
  }

  const bool valid =
    data[0] == 0x03 &&
    data[1] == 0x00 &&
    lumpLength >= 8;

  if (!valid) {
    W_ReleaseLumpNum(lumpNum);
    return false;
  }

  sampleRate = (static_cast<int>(data[3]) << 8) | static_cast<int>(data[2]);
  const int declaredLength =
    (static_cast<int>(data[7]) << 24) |
    (static_cast<int>(data[6]) << 16) |
    (static_cast<int>(data[5]) << 8) |
    static_cast<int>(data[4]);

  if (
    sampleRate < 8000 ||
    sampleRate > 96000 ||
    declaredLength <= 32 ||
    declaredLength > lumpLength - 8
  ) {
    W_ReleaseLumpNum(lumpNum);
    return false;
  }

  const int sampleCount = declaredLength - 32;
  const byte* pcm = data + 24;
  samples.resize(static_cast<size_t>(sampleCount));
  for (int i = 0; i < sampleCount; ++i) {
    samples[static_cast<size_t>(i)] = (static_cast<float>(pcm[i]) - 128.0f) / 128.0f;
  }

  W_ReleaseLumpNum(lumpNum);
  return true;
}

int DG_StartSound(sfxinfo_t* sfxinfo, int channel, int vol, int sep) {
  int sampleRate = 0;
  std::vector<float> samples;
  if (!decodeDoomSfx(sfxinfo, sampleRate, samples)) {
    return -1;
  }

  const float volume = static_cast<float>(vol) / 127.0f;
  const float pan = (static_cast<float>(sep) - 128.0f) / 127.0f;
  if (auto* engine = reactnativedoom::currentDoomEngine()) {
    engine->enqueueAudioEvent(
      sfxIdForInfo(sfxinfo),
      channel,
      sampleRate,
      volume,
      pan,
      std::move(samples)
    );
  }

  return channel;
}

void DG_StopSound(int channel) {
  (void)channel;
}

boolean DG_SoundIsPlaying(int channel) {
  (void)channel;
  return false;
}

void DG_CacheSounds(sfxinfo_t* sounds, int numSounds) {
  (void)sounds;
  (void)numSounds;
}

boolean DG_InitMusic() {
  return false;
}

void DG_ShutdownMusic() {}
void DG_SetMusicVolume(int volume) { (void)volume; }
void DG_PauseMusic() {}
void DG_ResumeMusic() {}
void* DG_RegisterSong(void* data, int len) {
  (void)data;
  (void)len;
  return nullptr;
}
void DG_UnRegisterSong(void* handle) { (void)handle; }
void DG_PlaySong(void* handle, boolean looping) {
  (void)handle;
  (void)looping;
}
void DG_StopSong() {}
boolean DG_MusicIsPlaying() { return false; }
void DG_PollMusic() {}
} // namespace

extern "C" sound_module_t DG_sound_module = {
  g_soundDevices,
  g_soundDeviceCount,
  DG_InitSound,
  DG_ShutdownSound,
  DG_GetSfxLumpNum,
  DG_UpdateSound,
  DG_UpdateSoundParams,
  DG_StartSound,
  DG_StopSound,
  DG_SoundIsPlaying,
  DG_CacheSounds,
};

extern "C" music_module_t DG_music_module = {
  g_soundDevices,
  g_soundDeviceCount,
  DG_InitMusic,
  DG_ShutdownMusic,
  DG_SetMusicVolume,
  DG_PauseMusic,
  DG_ResumeMusic,
  DG_RegisterSong,
  DG_UnRegisterSong,
  DG_PlaySong,
  DG_StopSong,
  DG_MusicIsPlaying,
  DG_PollMusic,
};

extern "C" int use_libsamplerate = 0;
extern "C" float libsamplerate_scale = 0.65f;
