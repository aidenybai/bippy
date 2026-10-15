import { useState } from "react";

/**
 * Syntax the compiler can't lower bails out the whole component, even inside a handler.
 */

// taxonomy components/editor.tsx:36-40: dynamic `import()` inside a handler/effect.
// "(BuildHIR::lowerExpression) Handle ImportKeyword expressions"
export function DynamicImport() {
  const [ready, setReady] = useState(false);
  const load = async () => {
    await import("./name-collision-styled");
    setReady(true);
  };
  return <button onClick={load}>{ready ? "ready" : "load"}</button>;
}
