import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@_silgen_name("ReactNativeDoomQueueHardwareKey")
private func ReactNativeDoomQueueHardwareKey(_ key: UnsafePointer<CChar>, _ pressed: Int32)

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "ReactNativeDoom",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

private final class DoomKeyboardViewController: UIViewController {
  private var activeDoomKeys = Set<String>()

  private let doomKeyByKeyboardUsage: [UIKeyboardHIDUsage: String] = [
    .keyboard1: "1",
    .keyboard2: "2",
    .keyboard3: "3",
    .keyboard4: "4",
    .keyboard5: "5",
    .keyboard6: "6",
    .keyboard7: "7",
    .keyboard8: "8",
    .keypad1: "1",
    .keypad2: "2",
    .keypad3: "3",
    .keypad4: "4",
    .keypad5: "5",
    .keypad6: "6",
    .keypad7: "7",
    .keypad8: "8",
    .keyboardW: "up",
    .keyboardS: "down",
    .keyboardA: "strafe-left",
    .keyboardD: "strafe-right",
    .keyboardUpArrow: "up",
    .keyboardDownArrow: "down",
    .keyboardLeftArrow: "left",
    .keyboardRightArrow: "right",
    .keyboardSpacebar: "fire",
    .keyboardF: "fire",
    .keyboardLeftControl: "fire",
    .keyboardRightControl: "fire",
    .keyboardE: "use",
    .keyboardU: "use",
    .keyboardLeftShift: "shift",
    .keyboardRightShift: "shift",
    .keyboardLeftAlt: "strafe",
    .keyboardRightAlt: "strafe",
    .keyboardTab: "tab",
    .keyboardReturnOrEnter: "enter",
    .keyboardReturn: "enter",
    .keypadEnter: "enter",
    .keyboardEscape: "escape",
  ]

  override var canBecomeFirstResponder: Bool {
    true
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    becomeFirstResponder()
  }

  override func viewWillDisappear(_ animated: Bool) {
    releaseActiveDoomKeys()
    super.viewWillDisappear(animated)
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let unhandledPresses = handlePresses(presses, pressed: true)
    if !unhandledPresses.isEmpty {
      super.pressesBegan(unhandledPresses, with: event)
    }
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let unhandledPresses = handlePresses(presses, pressed: false)
    if !unhandledPresses.isEmpty {
      super.pressesEnded(unhandledPresses, with: event)
    }
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let unhandledPresses = handlePresses(presses, pressed: false)
    if !unhandledPresses.isEmpty {
      super.pressesCancelled(unhandledPresses, with: event)
    }
  }

  private func handlePresses(_ presses: Set<UIPress>, pressed: Bool) -> Set<UIPress> {
    var unhandledPresses = Set<UIPress>()

    for press in presses {
      guard let doomKey = doomKey(for: press) else {
        unhandledPresses.insert(press)
        continue
      }

      queueDoomKey(doomKey, pressed: pressed)
    }

    return unhandledPresses
  }

  private func doomKey(for press: UIPress) -> String? {
    guard let key = press.key else {
      return nil
    }

    return doomKeyByKeyboardUsage[key.keyCode]
  }

  private func queueDoomKey(_ key: String, pressed: Bool) {
    if pressed {
      guard activeDoomKeys.insert(key).inserted else {
        return
      }
    } else {
      guard activeDoomKeys.remove(key) != nil else {
        return
      }
    }

    key.withCString { keyPointer in
      ReactNativeDoomQueueHardwareKey(keyPointer, pressed ? 1 : 0)
    }
  }

  private func releaseActiveDoomKeys() {
    let keysToRelease = activeDoomKeys
    activeDoomKeys.removeAll()

    for key in keysToRelease {
      key.withCString { keyPointer in
        ReactNativeDoomQueueHardwareKey(keyPointer, 0)
      }
    }
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func createRootViewController() -> UIViewController {
    DoomKeyboardViewController()
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
