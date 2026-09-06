import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app";

const ENABLE_STRICT_MODE = false;

const mount = () => {
  const root = createRoot(document.getElementById("root")!);
  const main = <App title="entry patterns" />;
  root.render(ENABLE_STRICT_MODE ? <StrictMode>{main}</StrictMode> : main);
};

mount();
