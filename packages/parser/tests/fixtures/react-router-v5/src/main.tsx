import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom-v5";
import { routes } from "./routes";

createRoot(document.getElementById("root")!).render(<BrowserRouter>{routes}</BrowserRouter>);
