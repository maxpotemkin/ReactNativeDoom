#pragma once

#include <NitroModules/ArrayBuffer.hpp>
#include <NitroModules/HybridObject.hpp>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

namespace reactnativedoom {

class DoomEngine final : public margelo::nitro::HybridObject {
public:
  DoomEngine();
  ~DoomEngine() override = default;

  std::string getDefaultIWadPath();
  std::string getLoadedIWadPath();
  std::string getLastStatus();
  std::string getWindowTitle();
  double getWidth();
  double getHeight();
  double getFrameCount();
  bool getIsStarted();

  std::string start(const std::string& iwadPath);
  bool tick();
  std::shared_ptr<margelo::nitro::ArrayBuffer> tickAndGetFrame();
  std::shared_ptr<margelo::nitro::ArrayBuffer> tickAndGetFrameAudio();
  void openMenu();
  void queueKey(const std::string& key, bool pressed);
  std::shared_ptr<margelo::nitro::ArrayBuffer> getFrame();

  void onDrawFrame();
  void enqueueAudioEvent(
    int sfxId,
    int channel,
    int sampleRate,
    float volume,
    float pan,
    std::vector<float>&& samples
  );
  int pollKey(int* pressed, unsigned char* key);
  void setWindowTitle(const char* title);

protected:
  void loadHybridMethods() override;
  size_t getExternalMemorySize() noexcept override;

private:
  struct AudioEvent {
    int sfxId;
    int channel;
    int sampleRate;
    float volume;
    float pan;
    std::vector<float> samples;
  };

  void pushKey(bool pressed, unsigned char key);
  unsigned char mapKey(const std::string& key) const;
  std::shared_ptr<margelo::nitro::ArrayBuffer> copyFrameAsRgba();
  void writeFrameAsRgba(uint8_t* output);

  static constexpr auto TAG = "DoomEngine";
  static constexpr int WIDTH = 320;
  static constexpr int HEIGHT = 200;
  static constexpr size_t FRAME_BYTES = WIDTH * HEIGHT * 4;
  static constexpr size_t MAX_AUDIO_EVENTS = 64;

  bool started_ = false;
  double frameCount_ = 0;
  std::string loadedIWadPath_;
  std::string lastStatus_ = "idle";
  std::string windowTitle_ = "DOOM";
  std::vector<std::string> argvStorage_;
  std::vector<char*> argv_;
  std::deque<unsigned short> keyQueue_;
  std::deque<AudioEvent> audioEvents_;
  std::mutex mutex_;
  std::mutex audioMutex_;
};

void registerDoomEngineHybridObject();
DoomEngine* currentDoomEngine();
std::string findBundledIWadPath();

} // namespace reactnativedoom
