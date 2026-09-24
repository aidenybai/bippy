import { createRoot } from "react-dom/client";

delete window.__BIPPY_NEW_GLOBAL__;
const isFirst = Math.random() > 0.5;
if (isFirst) {
  delete window.__BIPPY_DEFINE_COUNT__;
  window.__BIPPY_NEW_GLOBAL__ = undefined;
}

createRoot(document.getElementById("root")!).render(
  <main>
    {isFirst ? <header /> : <footer />}
    {"__BIPPY_DEFINE_COUNT__" in window ? <strong /> : <em />}
    {"__BIPPY_NEW_GLOBAL__" in window ? <b /> : <u />}
    <p>
      {typeof __BIPPY_DEFINE_COUNT__}
      <i />
    </p>
  </main>,
);
