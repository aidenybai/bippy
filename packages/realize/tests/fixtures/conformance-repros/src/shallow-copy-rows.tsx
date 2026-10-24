import { useState } from "react";

interface Row {
  email: string;
}

export const DirectRowEdit = () => {
  const [rows, setRows] = useState<Row[]>([{ email: "" }]);
  return (
    <input
      value={rows[0]?.email ?? ""}
      onChange={(event) => {
        const row = rows[0];
        if (!row) return;
        row.email = event.target.value;
        setRows([...rows]);
      }}
    />
  );
};

export const CopiedRowEdit = () => {
  const [rows, setRows] = useState<Row[]>([{ email: "" }]);
  return (
    <input
      value={rows[0]?.email ?? ""}
      onChange={(event) => {
        const next = [...rows];
        const row = next[0];
        if (!row) return;
        row.email = event.target.value;
        setRows(next);
      }}
    />
  );
};

export const IndexedRowEdit = ({ index }: { index: number }) => {
  const [rows, setRows] = useState<Row[]>([{ email: "" }]);
  return (
    <input
      value={rows[index]?.email ?? ""}
      onChange={(event) => {
        const next = [...rows];
        const row = next[index];
        if (!row) return;
        row.email = event.target.value;
        setRows(next);
      }}
    />
  );
};

export const IndexedDirectEdit = ({ index }: { index: number }) => {
  const [rows, setRows] = useState<Row[]>([{ email: "" }]);
  return (
    <input
      value={rows[index]?.email ?? ""}
      onChange={(event) => {
        const row = rows[index];
        if (!row) return;
        row.email = event.target.value;
        setRows([...rows]);
      }}
    />
  );
};

export const ClonedRowEdit = ({ index }: { index: number }) => {
  const [rows, setRows] = useState<Row[]>([{ email: "" }]);
  return (
    <input
      value={rows[index]?.email ?? ""}
      onChange={(event) => {
        const next = rows.map((row) => ({ ...row }));
        const row = next[index];
        if (!row) return;
        row.email = event.target.value;
        setRows(next);
      }}
    />
  );
};

export const AppendedRowEdit = () => {
  const [rows, setRows] = useState<Row[]>([{ email: "" }]);
  return (
    <button
      type="button"
      onClick={() => {
        const next = [...rows];
        next.push({ email: "" });
        setRows(next);
      }}
    >
      {rows.length}
    </button>
  );
};
