cmake_minimum_required(VERSION 3.13)
project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

set(ROOT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../..")
set(DOOM_ENGINE_DIR "${ROOT_DIR}/cpp/doom_engine")
set(DOOMGENERIC_DIR "${ROOT_DIR}/third_party/doomgeneric/doomgeneric")

file(GLOB DOOMGENERIC_SOURCES CONFIGURE_DEPENDS "${DOOMGENERIC_DIR}/*.c")
list(FILTER DOOMGENERIC_SOURCES EXCLUDE REGEX "doomgeneric_(allegro|emscripten|linuxvt|sdl|soso|sosox|win|xlib)\\.c$")
list(FILTER DOOMGENERIC_SOURCES EXCLUDE REGEX "i_(allegro|sdl).*\\.c$")
list(FILTER DOOMGENERIC_SOURCES EXCLUDE REGEX "i_(cdmus|joystick|sound|system)\\.c$")
list(FILTER DOOMGENERIC_SOURCES EXCLUDE REGEX "mus2mid\\.c$")

add_library(
  reactnativedoom_engine
  SHARED
  doom/DoomEngineOnLoad.cpp
  "${DOOM_ENGINE_DIR}/DoomEngine.cpp"
  "${DOOM_ENGINE_DIR}/DoomEnginePlatformAndroid.cpp"
  "${DOOM_ENGINE_DIR}/DoomEngineSystem.cpp"
  ${DOOMGENERIC_SOURCES}
)

set_target_properties(
  reactnativedoom_engine
  PROPERTIES
  CXX_STANDARD 20
  CXX_STANDARD_REQUIRED ON
)

target_include_directories(
  reactnativedoom_engine
  PRIVATE
  "${DOOM_ENGINE_DIR}"
  "${DOOMGENERIC_DIR}"
)

target_compile_definitions(
  reactnativedoom_engine
  PRIVATE
  NORMALUNIX=1
  __ANDROID__=1
  FEATURE_SOUND=1
  DOOMGENERIC_ANDROID=1
  DOOMGENERIC_RESX=320
  DOOMGENERIC_RESY=200
)

target_compile_options(
  reactnativedoom_engine
  PRIVATE
  -Wall
  -Wextra
)

find_library(LOG_LIB log)
find_package(react-native-nitro-modules REQUIRED CONFIG)

target_link_libraries(
  reactnativedoom_engine
  PRIVATE
  ${LOG_LIB}
  android
  react-native-nitro-modules::NitroModules
  jsi
)

if(TARGET reactnative)
  target_link_libraries(reactnativedoom_engine PRIVATE reactnative)
endif()
