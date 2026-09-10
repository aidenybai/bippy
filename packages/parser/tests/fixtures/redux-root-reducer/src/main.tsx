import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { App } from "./app";
import { store } from "./store";

createRoot(document.getElementById("root")!).render(
  <Provider store={store}>
    <App />
  </Provider>,
);
