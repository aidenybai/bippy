import { useReducer, useState } from "react";
import { useSelectableList } from "selection-hooks";

export const SelectionCount = () => {
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  useSelectableList({ selection, onSelectionChange: setSelection });
  return <p>{Object.keys(selection).length > 0 ? "some selected" : "none selected"}</p>;
};

const reduceSelection = (_state: Record<string, boolean>, next: Record<string, boolean>) => next;

export const SelectionDispatch = () => {
  const [selection, dispatch] = useReducer(reduceSelection, {});
  useSelectableList({ selection, onSelectionChange: dispatch });
  return <p>{Object.keys(selection).length > 0 ? "some selected" : "none selected"}</p>;
};
