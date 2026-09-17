import * as namespace from "./modules/conflict";

export default () => (
  <main>
    <span>Result:</span>
    {`${typeof namespace.value}:${namespace.left}:${namespace.right}:${typeof namespace.default}`}
  </main>
);
