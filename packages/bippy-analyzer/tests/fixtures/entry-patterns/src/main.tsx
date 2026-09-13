import "./extensions";
import { initApp } from "./init-app";
import { unsupported } from "./unsupported";

if (typeof BigInt === "undefined") {
  unsupported();
} else {
  initApp();
}
