import { useState } from "react";

/**
 * Syntax the compiler can't lower bails out the whole component, even inside a handler.
 */

// A `break` that leaves a try statement with a finally clause.
// "(BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause and an early exit"
export function BreakOutOfTry() {
  const [found, setFound] = useState<string | null>(null);
  const search = () => {
    for (const name of ["first", "second"]) {
      try {
        if (name === "second") {
          setFound(name);
          break;
        }
      } finally {
        console.log(name);
      }
    }
  };
  return <button onClick={search}>{found ?? "search"}</button>;
}
