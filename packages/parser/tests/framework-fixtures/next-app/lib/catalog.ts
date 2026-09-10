const CATALOG_TTL_MS = 60_000;

let catalogCache: { value: string[]; expiresAt: number } | null = null;

export const readCatalog = async (): Promise<string[]> => {
  const now = Date.now();
  if (catalogCache && catalogCache.expiresAt > now) return catalogCache.value;
  const value = ["alpha", "beta"];
  catalogCache = { value, expiresAt: now + CATALOG_TTL_MS };
  return value;
};
