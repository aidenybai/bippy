import { useEffect, useState } from "react";

const VERSION_KEY = "storage-fixture:version";
const THEME_KEY = "storage-fixture:theme";
const DRAFT_KEY = "storage-fixture:draft";

window.localStorage.setItem(VERSION_KEY, JSON.stringify(Date.now()));

const readDraft = (): "empty" | "restored" =>
  window.localStorage.getItem(DRAFT_KEY) === null ? "empty" : "restored";

const StorageKnownKeyWrites = () => {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [draft, setDraft] = useState(readDraft);
  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, theme);
    setDraft(readDraft());
  }, [theme]);
  const isVersioned = window.localStorage.getItem(VERSION_KEY) !== null;
  return (
    <div>
      <p>
        draft {draft}, versioned {String(isVersioned)}, entries {window.localStorage.length}
      </p>
      <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
        {theme}
      </button>
    </div>
  );
};

export default StorageKnownKeyWrites;
