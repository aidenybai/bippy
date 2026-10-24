// @ts-nocheck
import { useState } from "react";

export const PinnedMode = () => {
  const [mode, setMode] = useState<"edit" | "view">("view");
  return mode === "edit" ? (
    <button onClick={() => setMode("view")}>{mode}</button>
  ) : (
    <button onClick={() => setMode("edit")}>{mode}</button>
  );
};

export const DecidedComparison = () => {
  const [mode, setMode] = useState<"edit" | "view">("view");
  return mode === "edit" ? (
    <p onClick={() => setMode("view")}>{mode === "edit"}</p>
  ) : (
    <p onClick={() => setMode("edit")}>{mode !== "view"}</p>
  );
};

export const UnpinnedMode = ({ mode }: { mode: "edit" | "view" | "preview" }) =>
  mode === "edit" ? <p>Editing</p> : <p>{mode}</p>;
