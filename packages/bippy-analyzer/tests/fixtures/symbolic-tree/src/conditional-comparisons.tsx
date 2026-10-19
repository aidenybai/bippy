import { useState } from "react";

export const TitleButton = ({ initialTitle }: { initialTitle?: string }) => {
  const [title, setTitle] = useState(initialTitle);
  const label = title ?? "Untitled";
  return (
    <button onClick={() => setTitle("Draft")}>
      {label === "Untitled" ? "Name this draft" : label}
    </button>
  );
};

export const ColumnLayout = ({ width }: { width: number }) => {
  const [isWide, setIsWide] = useState(false);
  const usableWidth = isWide ? width : 0;
  return (
    <div onClick={() => setIsWide(!isWide)}>
      {usableWidth > 600 ? <p>Two columns</p> : <p>One column</p>}
      {usableWidth > 600 && !isWide ? <p>Unreachable</p> : null}
    </div>
  );
};
