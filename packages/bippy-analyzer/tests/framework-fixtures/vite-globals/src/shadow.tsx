import { createRoot } from "react-dom/client";

const __BIPPY_DEFINE_LABEL__ = "local";
const getCount = (__BIPPY_DEFINE_COUNT__: number) => __BIPPY_DEFINE_COUNT__ + 1;

createRoot(document.getElementById("root")!).render(
  <main>
    <p>
      {__BIPPY_DEFINE_LABEL__}
      <i />
      {Reflect.get(globalThis, "__BIPPY_DEFINE_LABEL__")}
    </p>
    <p>
      {getCount(6)}
      <i />
      {__BIPPY_DEFINE_COUNT__}
    </p>
  </main>,
);
