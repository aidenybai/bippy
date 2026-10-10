import { useState } from "react";

/**
 * Crash: "[hoisting] EnterSSA: Expected identifier to be defined before being used".
 *
 * gatherCapturedContext (src/core/hir/build-hir.ts:4379) treats every Identifier
 * node inside a nested function as a captured reference, including ones that are
 * not references: a function declaration's own name, and property names such as
 * `item.total`. Those resolve by text to a binding in the enclosing scope, so the
 * nested function "captures" a variable before it is declared. EnterSSA's
 * unmarkUnknown workaround (src/core/ssa/enter-ssa.ts:112) only undoes this when
 * the read resolves without a phi, so it throws once any control flow (`||`, `?:`,
 * `??`, `if`) precedes the nested function. The throw is not caught per
 * component (src/core/entrypoint/pipeline.ts:53), so it aborts the whole project.
 *
 * Seen in: control-gastos BudgetForm/ExpenseForm, taxonomy user-auth-form,
 * wild-oasis, sonner Toast (getLoadingIcon), invoify ChargesContextProvider.
 */

// A function declaration captures its own name.
export function HoistedDeclarationAfterBranch() {
  const [budget] = useState(0);
  const isValid = budget < 0 || budget > 10;
  function handleSubmit() {}
  return <form onSubmit={handleSubmit}>{String(isValid)}</form>;
}

// `item.total` is captured as the later `let total` (invoify ChargesContext.tsx:164-187).
export function PropertyNameCapturedAsLaterLocal({ items }: { items: { total: number }[] }) {
  const [sum, setSum] = useState(0);
  const label = sum > 0 ? "positive" : "empty";
  const recalculate = () => {
    const subtotal = items.reduce((accumulator, item) => accumulator + item.total, 0);
    let total = subtotal;
    total -= 1;
    setSum(total);
  };
  return <button onClick={recalculate}>{label}</button>;
}
