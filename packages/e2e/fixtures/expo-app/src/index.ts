import "bippy/install-hook-only";
import { registerRootComponent } from "expo";
import { NativeModules, TurboModuleRegistry } from "react-native";
import App from "./App";

interface DevSettingsModule {
  setHotLoadingEnabled?: (isHotLoadingEnabled: boolean) => void;
}

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
}

registerRootComponent(App);
