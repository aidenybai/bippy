import * as namespace from "./modules/override";

export default () => (
  <main>
    <span>Result:</span>
    {`${Object.keys(namespace).join(",")}:${namespace.value}:${namespace.default}`}
  </main>
);
