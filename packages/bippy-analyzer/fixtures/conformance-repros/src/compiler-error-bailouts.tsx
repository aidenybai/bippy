import { useState } from "react";

/**
 * `compiler-error` bailouts inherited from the React Compiler's BuildHIR Todos
 * (src/core/hir/build-hir.ts). The whole component is lost even though the
 * unsupported syntax is inside an event handler, not the render path.
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

// invoify contexts/InvoiceContext.tsx:334-353: try/finally and throw inside try.
// "(BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause"
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
