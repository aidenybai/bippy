import "bippy/install-hook-only";
import { registerRootComponent } from "expo";
import { NativeModules } from "react-native";
import App from "./App";

// fast refresh must be on for the react-refresh e2e spec; the setting
// persists in NSUserDefaults per simulator, so a stale "off" from a previous
// CI run or dev menu toggle would silently break HMR-driven tests
if (__DEV__) {
  NativeModules.DevSettings?.setHotLoadingEnabled?.(true);
}

registerRootComponent(App);
