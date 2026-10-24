import { useEffect, useState } from "react";

/**
 * An effect that sets state on several paths, returning after each, leads to every value it
 * sets, not only the last one.
 */

// jsoncrack apps/www/src/features/editor/ExternalMode.tsx:7
export const ExternalNotice = () => {
  const [isExternal, setExternal] = useState(false);

  useEffect(() => {
    if (window.location.pathname.includes("widget")) return setExternal(false);
    if (window.location.host !== "jsoncrack.com") return setExternal(true);
    return setExternal(false);
  }, []);

  if (!isExternal) return null;
  return <p onClick={() => setExternal(false)}>Using an external build</p>;
};
