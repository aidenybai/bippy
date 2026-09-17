import { createRoot } from "react-dom/client";
import { App } from "./app";

const portalTarget = document.createElement("aside");
portalTarget.id = "portal-target";
document.body.appendChild(portalTarget);

createRoot(document.getElementById("root")!).render(<App />);
