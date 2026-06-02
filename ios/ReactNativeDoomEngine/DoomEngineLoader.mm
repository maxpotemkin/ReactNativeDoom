#import <Foundation/Foundation.h>

#include "DoomEngine.hpp"

@interface DoomEngineLoader : NSObject
@end

@implementation DoomEngineLoader

+ (void)load {
  reactnativedoom::registerDoomEngineHybridObject();
}

@end
