require "json"
require_relative "node_modules/react-native/scripts/react_native_pods"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ReactNativeDoomEngine"
  s.version      = package["version"]
  s.summary      = "iOS Doom engine bridge for ReactNativeDoom"
  s.description  = "Local Nitro HybridObject bridge that runs doomgeneric and exposes rendered frames to React Native."
  s.homepage     = "https://github.com/ozkl/doomgeneric"
  s.license      = { :type => "GPL-2.0", :file => "third_party/doomgeneric/LICENSE" }
  s.authors      = package["name"]
  s.source       = { :path => "." }
  s.platforms    = { :ios => min_ios_version_supported }
  s.requires_arc = true

  s.source_files = [
    "ios/ReactNativeDoomEngine/**/*.{h,m,mm,cpp}",
    "cpp/doom_engine/**/*.{h,hpp,c,cpp,mm}",
    "third_party/doomgeneric/doomgeneric/**/*.{c,h}",
  ]

  s.exclude_files = [
    "third_party/doomgeneric/doomgeneric/doomgeneric_allegro.c",
    "third_party/doomgeneric/doomgeneric/doomgeneric_emscripten.c",
    "third_party/doomgeneric/doomgeneric/doomgeneric_linuxvt.c",
    "third_party/doomgeneric/doomgeneric/doomgeneric_sdl.c",
    "third_party/doomgeneric/doomgeneric/doomgeneric_soso.c",
    "third_party/doomgeneric/doomgeneric/doomgeneric_sosox.c",
    "third_party/doomgeneric/doomgeneric/doomgeneric_win.c",
    "third_party/doomgeneric/doomgeneric/doomgeneric_xlib.c",
    "third_party/doomgeneric/doomgeneric/i_allegromusic.c",
    "third_party/doomgeneric/doomgeneric/i_allegrosound.c",
    "third_party/doomgeneric/doomgeneric/i_sdlmusic.c",
    "third_party/doomgeneric/doomgeneric/i_sdlsound.c",
    "third_party/doomgeneric/doomgeneric/mus2mid.c",
  ]

  s.resource_bundles = {
    "ReactNativeDoomEngine" => ["assets/doom/DOOM1.WAD"],
  }

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) NORMALUNIX=1 __MACOSX__=1 FEATURE_SOUND=1 DOOMGENERIC_IOS=1 DOOMGENERIC_RESX=320 DOOMGENERIC_RESY=200",
    "USE_HEADERMAP" => "NO",
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/third_party/doomgeneric/doomgeneric\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp/doom_engine\"",
    ].join(" "),
  }

  s.dependency "NitroModules"
  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
end
