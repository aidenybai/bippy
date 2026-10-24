import { useCallback } from "react";
import type { RefObject } from "react";

interface CellMeta {
  cellMapRef: RefObject<Map<string, HTMLDivElement>>;
}

export const RegisteredCell = ({ cellId, meta }: { cellId: string; meta: CellMeta }) => {
  const cellMapRef = meta.cellMapRef;
  const registerCell = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) cellMapRef.current.set(cellId, node);
      else cellMapRef.current.delete(cellId);
    },
    [cellId, cellMapRef],
  );
  return <div ref={registerCell}>{cellId}</div>;
};
