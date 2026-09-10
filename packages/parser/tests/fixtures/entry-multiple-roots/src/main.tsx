import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { Overlay } from "./overlay";

const overlayContainer = document.createElement("div");
document.body.appendChild(overlayContainer);
createRoot(overlayContainer).render(<Overlay message="dev overlay" />);

const root = createRoot(document.getElementById("root")!);
root.render(<p>loading</p>);
root.render(
  <StrictMode>
    <App title="welcome" />
  </StrictMode>,
);
