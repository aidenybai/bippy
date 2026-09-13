import { createRoot } from "react-dom/client";
import { App } from "./app";

window.ENV = { MODE: "development", ALLOW_INDEXING: "true" };

createRoot(document.getElementById("root")!).render(<App />);
