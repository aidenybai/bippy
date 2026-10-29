import { useState } from "react";

// taxonomy components/editor.tsx:36-40: dynamic `import()` inside a handler.
export function DynamicImport() {
  const [ready, setReady] = useState(false);
  const load = async () => {
    await import("./name-collision-styled");
    setReady(true);
  };
  return <button onClick={load}>{ready ? "ready" : "load"}</button>;
}
