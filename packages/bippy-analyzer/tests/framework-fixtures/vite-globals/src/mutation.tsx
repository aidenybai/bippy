import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const App = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const config = __BIPPY_DEFINE_CONFIG__;
    __BIPPY_DEFINE_COUNT__ += 1;
    __BIPPY_DEFINE_FLAG__ = true;
    window.__BIPPY_DEFINE_LABEL__ = "changed";
    config.nested.value = "mutated";
    setReady(true);
  }, []);
  return (
    <main>
      <p>
        {__BIPPY_DEFINE_COUNT__}
        <i />
        {String(__BIPPY_DEFINE_FLAG__)}
      </p>
      <p>
        {Reflect.get(globalThis, "__BIPPY_DEFINE_LABEL__")}
        <i />
        {__BIPPY_DEFINE_CONFIG__.nested.value}
      </p>
      {ready ? <strong /> : <em />}
    </main>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
