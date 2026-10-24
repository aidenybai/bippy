import { useState } from "react";

/**
 * A state initialized from an untyped value cast to a type can hold anything the value
 * does, since the cast only asserts the type.
 */

interface Cell {
  getValue: () => unknown;
}

// shadcn-table src/registry/bases/radix/components/data-grid/data-grid-cell-variants.tsx:785
export function CheckboxCell({ cell }: { cell: Cell }) {
  const [checked, setChecked] = useState(cell.getValue() as boolean);
  return (
    <button type="button" onClick={() => setChecked(!checked)}>
      {checked ? "on" : "off"}
    </button>
  );
}

export function ToggleCell({ initial }: { initial: boolean }) {
  const [checked, setChecked] = useState(initial as boolean);
  return (
    <button type="button" onClick={() => setChecked(!checked)}>
      {checked ? "on" : "off"}
    </button>
  );
}
