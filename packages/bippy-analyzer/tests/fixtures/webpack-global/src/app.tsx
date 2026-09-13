import { describeRoot, root } from "./root";

export const App = () => (
  <main>
    <code>
      {"= "}
      {describeRoot()}
    </code>
    <code>
      {"= "}
      {typeof root.document === "object" ? "browser" : "worker"}
    </code>
  </main>
);
