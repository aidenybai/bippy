import { createElement } from "react";

interface DynamicProps {
  [key: string]: unknown;
}

const copyProps = (source: DynamicProps): DynamicProps => {
  const result: DynamicProps = {};
  for (const key in source) {
    if (!key.startsWith("$")) result[key] = source[key];
  }
  return result;
};

const App = () => {
  const dynamicProps = Math.random() > 0.5 ? { id: "first" } : { className: "second" };
  const props = {
    ...dynamicProps,
    children: createElement("text", null, "kept"),
  };
  return createElement("main", null, createElement("svg", copyProps(props)));
};

export default App;
