import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={Reflect.get({ basename: null }, "basename")}>
    <main />
  </BrowserRouter>,
);
