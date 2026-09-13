import { createRoot } from "react-dom/client";
import { jsx } from "react/jsx-runtime";
import { App } from "./app.js";

createRoot(document.getElementById("root")).render(jsx(App, { rows: 2 }));
