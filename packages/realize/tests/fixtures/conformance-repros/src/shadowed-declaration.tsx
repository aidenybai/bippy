import { useState } from "react";

const THEMES = ["light", "dark", "auto"] as const;

export function ThemeCycler() {
  const [theme, setTheme] = useState<(typeof THEMES)[number]>("light");
  function nextTheme() {
    const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "light";
    setTheme(nextTheme);
  }
  return <button onClick={nextTheme}>{theme === "dark" ? "Dark" : "Bright"}</button>;
}

export function PageSizePicker() {
  const [pageSize, setPageSize] = useState(10);
  function pick(pick: number) {
    setPageSize(pick);
  }
  return (
    <div>
      <button onClick={() => pick(10)}>10</button>
      <button onClick={() => pick(50)}>50</button>
      {pageSize > 10 ? <p>Long page</p> : null}
    </div>
  );
}
