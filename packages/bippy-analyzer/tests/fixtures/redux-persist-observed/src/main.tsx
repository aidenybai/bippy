import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { App } from "./app";
import { persistor, store } from "./store";

createRoot(document.getElementById("root")!).render(
  <PersistGate loading={<p className="loading">loading</p>} persistor={persistor}>
    <Provider store={store}>
      <App />
    </Provider>
  </PersistGate>,
);
