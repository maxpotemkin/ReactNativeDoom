#include "DoomEngine.hpp"

#include <jni.h>
#include <string>

namespace reactnativedoom {

namespace {
JavaVM* g_javaVm = nullptr;
jclass g_loaderClass = nullptr;
jmethodID g_defaultIWadPathMethod = nullptr;

JNIEnv* getEnv(bool& didAttach) {
  didAttach = false;
  if (g_javaVm == nullptr) {
    return nullptr;
  }

  JNIEnv* env = nullptr;
  const jint status = g_javaVm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
  if (status == JNI_OK) {
    return env;
  }

  if (status == JNI_EDETACHED) {
    if (g_javaVm->AttachCurrentThread(&env, nullptr) == JNI_OK) {
      didAttach = true;
      return env;
    }
  }

  return nullptr;
}

std::string jStringToStdString(JNIEnv* env, jstring value) {
  if (value == nullptr) {
    return "";
  }

  const char* chars = env->GetStringUTFChars(value, nullptr);
  if (chars == nullptr) {
    return "";
  }

  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}
} // namespace

bool initializeAndroidPlatform(JavaVM* javaVm, JNIEnv* env) {
  g_javaVm = javaVm;

  jclass localLoaderClass = env->FindClass("com/reactnativedoom/DoomEngineLoader");
  if (localLoaderClass == nullptr) {
    if (env->ExceptionCheck()) {
      env->ExceptionClear();
    }
    return false;
  }

  g_loaderClass = static_cast<jclass>(env->NewGlobalRef(localLoaderClass));
  env->DeleteLocalRef(localLoaderClass);
  if (g_loaderClass == nullptr) {
    return false;
  }

  g_defaultIWadPathMethod =
    env->GetStaticMethodID(g_loaderClass, "defaultIWadPath", "()Ljava/lang/String;");
  if (g_defaultIWadPathMethod == nullptr) {
    if (env->ExceptionCheck()) {
      env->ExceptionClear();
    }
    return false;
  }

  return true;
}

std::string findBundledIWadPath() {
  if (g_defaultIWadPathMethod == nullptr || g_loaderClass == nullptr) {
    return "";
  }

  bool didAttach = false;
  JNIEnv* env = getEnv(didAttach);
  if (env == nullptr) {
    return "";
  }

  std::string path;
  auto result = static_cast<jstring>(
    env->CallStaticObjectMethod(g_loaderClass, g_defaultIWadPathMethod)
  );
  if (!env->ExceptionCheck()) {
    path = jStringToStdString(env, result);
  }
  if (result != nullptr) {
    env->DeleteLocalRef(result);
  }

  if (env->ExceptionCheck()) {
    env->ExceptionClear();
  }

  if (didAttach) {
    g_javaVm->DetachCurrentThread();
  }

  return path;
}

} // namespace reactnativedoom
