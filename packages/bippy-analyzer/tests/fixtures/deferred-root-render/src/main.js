import { createRoot } from "react-dom/client";
import { App } from "./app.js";

setTimeout(() => {
  const root = createRoot(document.getElementById("root"));
  root.render(<App rows={2} />);
}, 1);
