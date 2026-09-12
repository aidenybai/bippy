import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Page } from "./page";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={Reflect.get(globalThis, "__BIPPY_UNKNOWN_BASENAME__")}>
    <Page />
  </BrowserRouter>,
);
