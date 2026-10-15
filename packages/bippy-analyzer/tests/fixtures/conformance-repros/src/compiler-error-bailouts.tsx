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

// invoify contexts/InvoiceContext.tsx:334-353: throw inside try.
// "(BuildHIR::lowerStatement) Support ThrowStatement inside of try/catch"
export function TryFinally() {
  const [isSaving, setIsSaving] = useState(false);
  const save = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api");
      if (!response.ok) throw new Error("failed");
    } catch (error) {
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };
  return <button onClick={save}>{isSaving ? "saving" : "save"}</button>;
}
