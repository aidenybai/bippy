import { useState } from "react";

const readTheme = (): string => window.localStorage.getItem("theme") ?? "light";

/** A write the analysis cannot value only clouds its own key; the other keys stay as the page found them. */
export default function StorageKeyWrites() {
  const [theme] = useState(() => {
    window.localStorage.setItem("last-visit", String(Date.now()));
    return readTheme();
  });
  return (
    <main data-theme={theme}>
      {theme === "light" ? <em>light</em> : <strong>{theme}</strong>}
      <small>{window.localStorage.length}</small>
    </main>
  );
}

export const isExact = true;
