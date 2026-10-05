import { useEffect, useId, useState } from "react";

// A CSS-in-JS cache keyed by a string derived from `useId()`: the raw id is
// normalized (`replace`, `toLowerCase`) and joined into a path on every render,
// and the second render must find the entry the first one inserted.

const styleCache = new Map<string, number>();

const registerStyle = (path: string[]): boolean => {
  const fullPath = path.join("|");
  const isCached = styleCache.has(fullPath);
  if (!isCached) styleCache.set(fullPath, styleCache.size + 1);
  return isCached;
};

const useCacheToken = (): string => {
  const rawId = useId();
  return rawId.replace(/:/g, "").toLowerCase();
};

const Themed = () => {
  const themeKey = useCacheToken();
  const [renderCount, setRenderCount] = useState(0);
  useEffect(() => {
    setRenderCount(1);
  }, []);
  const isCached = registerStyle(["theme", themeKey, "token"]);
  const isKnownCached = registerStyle(["theme", "Light:Mode".replace(/:/g, "").toLowerCase()]);
  return (
    <p>
      {isCached ? <b>cached</b> : <i>fresh</i>}
      {isKnownCached ? <b>known cached</b> : <i>known fresh</i>}
      <output>{renderCount}</output>
    </p>
  );
};

export const isExact = true;

export default function DerivedStringKeys() {
  return (
    <section>
      <Themed />
    </section>
  );
}
