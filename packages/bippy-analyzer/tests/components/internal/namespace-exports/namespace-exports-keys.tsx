import * as namespace from "./modules/conflict";

export default () => (
  <main>
    <span>Result:</span>
    {Object.keys(namespace).join(",")}
  </main>
);
