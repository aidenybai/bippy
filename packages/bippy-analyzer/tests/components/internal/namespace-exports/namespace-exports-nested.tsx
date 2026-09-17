import * as namespace from "./modules/nested";

export default () => (
  <main>
    <span>Result:</span>
    {`${Object.keys(namespace).join(",")}:${typeof namespace.value}`}
  </main>
);
