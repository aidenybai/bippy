import * as namespace from "./modules/diamond";

export default () => (
  <main>
    <span>Result:</span>
    {`${Object.keys(namespace).join(",")}:${namespace.value}`}
  </main>
);
