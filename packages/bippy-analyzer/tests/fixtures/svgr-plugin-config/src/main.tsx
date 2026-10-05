import { createRoot } from "react-dom/client";
import Logo from "./assets/logo.svg";

createRoot(document.getElementById("root")!).render(
  <header>
    <Logo className="logo" />
    <h1>Fixture</h1>
  </header>,
);
