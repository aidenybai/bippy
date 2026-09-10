import { useReducer } from "react";
import { createSelectorContext, useContextSelector } from "./shared/selector-context";

interface SheetState {
  rows: string[][];
  active: number | null;
}

type SheetAction = { type: "activate"; row: number } | { type: "add-row" };

const reduceSheet = (state: SheetState, action: SheetAction): SheetState => {
  switch (action.type) {
    case "activate":
      return { ...state, active: action.row };
    case "add-row":
      return { ...state, rows: [...state.rows, ["", ""]] };
  }
};

const INITIAL_STATE: SheetState = {
  rows: [
    ["a", "b"],
    ["c", "d"],
  ],
  active: null,
};

const sheetContext = createSelectorContext<[SheetState, (action: SheetAction) => void]>([
  INITIAL_STATE,
  () => {},
]);

const useSheet = <T,>(selector: (state: SheetState) => T): T =>
  useContextSelector(sheetContext, ([state]) => selector(state));

const useDispatch = () => useContextSelector(sheetContext, ([, dispatch]) => dispatch);

const Cell = ({ row, column }: { row: number; column: number }) => {
  const value = useSheet((state) => state.rows[row]?.[column]);
  const isActive = useSheet((state) => state.active === row);
  const dispatch = useDispatch();
  return (
    <td
      className={isActive ? "active" : undefined}
      onClick={() => dispatch({ type: "activate", row })}
    >
      {value}
    </td>
  );
};

const Row = ({ row, columns }: { row: number; columns: number }) => (
  <tr>
    {Array.from({ length: columns }, (_, column) => (
      <Cell key={column} row={row} column={column} />
    ))}
  </tr>
);

const Sheet = () => {
  const rowCount = useSheet((state) => state.rows.length);
  const columnCount = useSheet((state) => state.rows[0]?.length ?? 0);
  const dispatch = useDispatch();
  return (
    <table>
      <caption>
        <button type="button" onClick={() => dispatch({ type: "add-row" })}>
          add row
        </button>
      </caption>
      <tbody>
        {Array.from({ length: rowCount }, (_, row) => (
          <Row key={row} row={row} columns={columnCount} />
        ))}
      </tbody>
    </table>
  );
};

export const isExact = true;

export default function ContextProviderOverride() {
  const reducerElements = useReducer(reduceSheet, INITIAL_STATE);
  return (
    <sheetContext.Provider value={reducerElements}>
      <Sheet />
    </sheetContext.Provider>
  );
}
