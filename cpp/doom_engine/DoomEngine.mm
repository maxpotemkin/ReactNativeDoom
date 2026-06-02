#import <Foundation/Foundation.h>

#include "DoomEngine.hpp"

#include <NitroModules/HybridObjectRegistry.hpp>
#include <NitroModules/Prototype.hpp>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <thread>

extern "C" {
#include "doomgeneric.h"
#include "doomkeys.h"
}

namespace reactnativedoom {

namespace {
DoomEngine* g_engine = nullptr;
const auto g_startTime = std::chrono::steady_clock::now();

uint32_t getTicksMs() {
  const auto now = std::chrono::steady_clock::now();
  return static_cast<uint32_t>(
    std::chrono::duration_cast<std::chrono::milliseconds>(now - g_startTime).count()
  );
}

std::string nsStringToStdString(NSString* value) {
  if (value == nil) {
    return "";
  }
  return std::string([value UTF8String]);
}

std::string findBundledIWadPath() {
  NSBundle* mainBundle = [NSBundle mainBundle];
  NSString* path = [mainBundle pathForResource:@"DOOM1" ofType:@"WAD"];
  if (path != nil) {
    return nsStringToStdString(path);
  }

  NSURL* resourceBundleURL = [mainBundle URLForResource:@"ReactNativeDoomEngine" withExtension:@"bundle"];
  if (resourceBundleURL != nil) {
    NSBundle* resourceBundle = [NSBundle bundleWithURL:resourceBundleURL];
    path = [resourceBundle pathForResource:@"DOOM1" ofType:@"WAD"];
    if (path != nil) {
      return nsStringToStdString(path);
    }
  }

  for (NSBundle* bundle in [NSBundle allBundles]) {
    path = [bundle pathForResource:@"DOOM1" ofType:@"WAD"];
    if (path != nil) {
      return nsStringToStdString(path);
    }
  }

  return "";
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
    "-nosound",
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
  if (key == "fire") return KEY_FIRE;
  if (key == "use") return KEY_USE;
  if (key == "enter") return KEY_ENTER;
  if (key == "escape") return KEY_ESCAPE;
  if (key == "shift") return KEY_RSHIFT;
  if (key == "strafe") return KEY_LALT;
  if (key.size() == 1) return static_cast<unsigned char>(key[0]);
  throw std::invalid_argument("Unknown Doom key: " + key);
}

std::shared_ptr<margelo::nitro::ArrayBuffer> DoomEngine::copyFrameAsRgba() {
  auto rgba = margelo::nitro::ArrayBuffer::allocate(FRAME_BYTES);
  auto* output = rgba->data();
  if (DG_ScreenBuffer == nullptr) {
    std::memset(output, 0, FRAME_BYTES);
    return rgba;
  }

  auto* pixels = reinterpret_cast<const uint32_t*>(DG_ScreenBuffer);
  for (size_t i = 0; i < WIDTH * HEIGHT; ++i) {
    const uint32_t pixel = pixels[i];
    output[i * 4 + 0] = static_cast<unsigned char>((pixel >> 16) & 0xff);
    output[i * 4 + 1] = static_cast<unsigned char>((pixel >> 8) & 0xff);
    output[i * 4 + 2] = static_cast<unsigned char>(pixel & 0xff);
    output[i * 4 + 3] = 0xff;
  }
  return rgba;
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
