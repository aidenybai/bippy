import { initApp } from "./init-app";
import { unsupported } from "./unsupported";

declare global {
  interface Window {
    __legacyBrowser?: boolean;
  }
}

if (window.__legacyBrowser) {
  unsupported();
} else {
  initApp();
}
