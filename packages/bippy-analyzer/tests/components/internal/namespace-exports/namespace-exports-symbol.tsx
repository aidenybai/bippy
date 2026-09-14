import * as namespace from "./modules/conflict";

export default () => (
  <main>
    <span>Result:</span>
    {Object.hasOwn(namespace, Symbol.toStringTag) ? "yes" : "no"}
  </main>
);
