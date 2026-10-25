import { useState } from "react";

interface Row {
  count: number;
}

const bumpFirst = (rows: Row[]) => {
  rows[0].count++;
};

const bumpEach = (rows: Row[]) => {
  for (const row of rows) row.count++;
};

const appendRow = (rows: Row[]) => {
  rows.push({ count: 0 });
};

export const SlicedRowsHelper = () => {
  const [rows, setRows] = useState<Row[]>([{ count: 0 }]);
  return (
    <button
      onClick={() => {
        const next = rows.slice();
        bumpFirst(next);
        setRows(next);
      }}
    >
      {rows[0].count}
    </button>
  );
};

export const SpreadRowsLoopHelper = () => {
  const [rows, setRows] = useState<Row[]>([{ count: 0 }]);
  return (
    <button
      onClick={() => {
        const next = [...rows];
        bumpEach(next);
        setRows(next);
      }}
    >
      {rows[0].count}
    </button>
  );
};

export const CopiedRowsInRender = () => {
  const [rows] = useState<Row[]>([{ count: 0 }]);
  bumpFirst(Array.from(rows));
  return <p>{rows[0].count}</p>;
};

export const AppendedCopyHelper = () => {
  const [rows, setRows] = useState<Row[]>([{ count: 0 }]);
  return (
    <button
      onClick={() => {
        const next = rows.slice();
        appendRow(next);
        setRows(next);
      }}
    >
      {rows.length}
    </button>
  );
};
