const CACHE_KEY = "feature-cache";
const SESSION_KEY = "session";

const cacheFeatures = (): void => {
  const fetchedAt = Date.now();
  window.localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt, features: {} }));
};

const readSession = (): { did: string } | null => {
  const raw = window.localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
};

cacheFeatures();

export const isExact = true;

export default function StorageDynamicValueKeys() {
  const session = readSession();
  const hasCache = window.localStorage.getItem(CACHE_KEY) !== null;
  return (
    <section>
      {session ? <strong>{session.did}</strong> : <em>signed out</em>}
      <span>{hasCache ? "cached" : "uncached"}</span>
    </section>
  );
}
