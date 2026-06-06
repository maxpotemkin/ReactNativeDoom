#include "DoomEngine.hpp"

#include <jni.h>

namespace reactnativedoom {
bool initializeAndroidPlatform(JavaVM* javaVm, JNIEnv* env);
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* javaVm, void*) {
  JNIEnv* env = nullptr;
  if (javaVm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
    return JNI_ERR;
  }

  if (!reactnativedoom::initializeAndroidPlatform(javaVm, env)) {
    return JNI_ERR;
  }

  reactnativedoom::registerDoomEngineHybridObject();
  return JNI_VERSION_1_6;
}
