import { useState } from "react";

/**
 * Nested functions must capture only real references, not their own name or property
 * names, or SSA throws "Expected identifier to be defined before being used".
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
