import { createRoot } from "react-dom/client";

const App = () => {
  const processObject = Reflect.get(globalThis, "process");
  return (
    <main>
      <p>
        {__BIPPY_DEFINE_LABEL__}
        <i />
        {__BIPPY_DEFINE_COUNT__}
      </p>
      <p>
        {String(__BIPPY_DEFINE_FLAG__)}
        <i />
        {String(__BIPPY_DEFINE_NULL__)}
        <b />
        {typeof __BIPPY_DEFINE_UNDEFINED__}
      </p>
      <p>
        {__BIPPY_DEFINE_CONFIG__.nested.value}
        <i />
        {__BIPPY_DEFINE_CONFIG__ === Reflect.get(globalThis, "__BIPPY_DEFINE_CONFIG__") ? (
          <strong />
        ) : (
          <em />
        )}
      </p>
      <p>
        {typeof process}
        <i />
        {processObject.env.NODE_ENV}
      </p>
    </main>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
