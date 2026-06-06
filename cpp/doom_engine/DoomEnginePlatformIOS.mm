#import <Foundation/Foundation.h>

#include "DoomEngine.hpp"

namespace reactnativedoom {

namespace {
std::string nsStringToStdString(NSString* value) {
  if (value == nil) {
    return "";
  }
  return std::string([value UTF8String]);
}
} // namespace

std::string findBundledIWadPath() {
  NSBundle* mainBundle = [NSBundle mainBundle];
  NSString* path = [mainBundle pathForResource:@"DOOM1" ofType:@"WAD"];
  if (path != nil) {
    return nsStringToStdString(path);
  }

  NSURL* resourceBundleURL =
    [mainBundle URLForResource:@"ReactNativeDoomEngine" withExtension:@"bundle"];
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

} // namespace reactnativedoom
