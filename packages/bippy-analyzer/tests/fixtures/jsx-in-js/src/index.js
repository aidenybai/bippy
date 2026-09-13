import { createRoot } from "react-dom/client";
import App from "./components/App.js";

const root = createRoot(document.getElementById("root"));
root.render(<App title="Dashboard" />);
