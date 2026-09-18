import { createElement, type ReactNode } from "react";

interface DynamicProps {
  [key: string]: unknown;
}

interface ElementProps extends DynamicProps {
  children: ReactNode;
}

const copyProps = (source: DynamicProps): DynamicProps => {
  const result: DynamicProps = {};
  for (const key in source) {
    if (!key.startsWith("$")) result[key] = source[key];
  }
  return result;
};

const App = () => {
  const dynamicProps: DynamicProps = Reflect.get(globalThis, "__bippyPartialProps") ?? {};
  const props: ElementProps = {
    ...dynamicProps,
    children: createElement("text", null, "kept"),
  };
  return createElement("svg", copyProps(props));
};

export default App;
