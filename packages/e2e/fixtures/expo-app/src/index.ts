import "bippy/install-hook-only";
import { registerRootComponent } from "expo";
import { NativeModules, TurboModuleRegistry } from "react-native";
import HMRClient from "react-native/Libraries/Utilities/HMRClient";
import App from "./App";

interface DevSettingsModule {
  setHotLoadingEnabled?: (isHotLoadingEnabled: boolean) => void;
}

// above detox's default 1.5s idle-timer threshold so the retry loop never
// blocks detox synchronization
const HMR_ENABLE_RETRY_INTERVAL_MS = 2_000;
const HMR_ENABLE_MAX_ATTEMPTS = 30;

// fast refresh must be on for the react-refresh e2e spec; the setting
// persists in NSUserDefaults per simulator, so a fresh CI simulator (or a
// stale "off" from a previous run) would silently break HMR-driven tests.
// bridgeless RN exposes DevSettings through the TurboModule registry rather
// than the legacy NativeModules proxy, so check both
if (__DEV__) {
  const devSettings: DevSettingsModule | null =
    NativeModules.DevSettings ?? TurboModuleRegistry.get("DevSettings");
  console.log(
    `[bippy-hmr] devSettings=${String(Boolean(devSettings))} setHotLoadingEnabled=${typeof devSettings?.setHotLoadingEnabled}`,
  );
  devSettings?.setHotLoadingEnabled?.(true);

  // setHotLoadingEnabled is a no-op when the persisted setting already says
  // "enabled", yet the JS-side HMRClient can still be sitting in its disabled
  // state stashing every update (observed on CI: Metro pushes updates for
  // each save but the app never applies them). Calling HMRClient.enable()
  // directly forces the metro-runtime client to apply pending updates; it
  // throws until native calls HMRClient.setup(), so retry on an interval.
  let enableAttemptCount = 0;
  const enableIntervalId = setInterval(() => {
    enableAttemptCount++;
    try {
      HMRClient.enable();
      console.log(`[bippy-hmr] HMRClient.enable succeeded (attempt ${enableAttemptCount})`);
      clearInterval(enableIntervalId);
    } catch (enableError) {
      console.log(
        `[bippy-hmr] HMRClient.enable attempt ${enableAttemptCount} failed: ${String(enableError)}`,
      );
      if (enableAttemptCount >= HMR_ENABLE_MAX_ATTEMPTS) {
        clearInterval(enableIntervalId);
      }
    }
  }, HMR_ENABLE_RETRY_INTERVAL_MS);
}

registerRootComponent(App);
