import { createRoot } from "react-dom/client";

const isFirst = Math.random() > 0.5;
if (isFirst) window.__BIPPY_DEFINE_COUNT__ = 5;
else window.__BIPPY_DEFINE_COUNT__ = 8;

createRoot(document.getElementById("root")!).render(
  <main>
    {isFirst ? <header /> : <footer />}
    {Reflect.get(window, "__BIPPY_DEFINE_COUNT__") === 5 ? <strong /> : <em />}
  </main>,
);
