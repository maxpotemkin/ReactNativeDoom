#import <Foundation/Foundation.h>

#include <exception>

#include "DoomEngine.hpp"

@interface DoomEngineLoader : NSObject
@end

@implementation DoomEngineLoader

+ (void)load {
  reactnativedoom::registerDoomEngineHybridObject();
}

@end

extern "C" void ReactNativeDoomQueueHardwareKey(const char* key, int pressed) {
  if (key == nullptr) {
    return;
  }

  auto* engine = reactnativedoom::currentDoomEngine();
  if (engine == nullptr) {
    return;
  }

  try {
    engine->queueKey(std::string(key), pressed != 0);
  } catch (const std::exception& error) {
    NSLog(@"[Doom] Ignored hardware key %s: %s", key, error.what());
  }
}
