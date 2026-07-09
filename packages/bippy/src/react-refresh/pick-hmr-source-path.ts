/**
 * Picks the file path most likely to be the source of an HMR update.
 * Tailwind JIT emits a js-update for the stylesheet alongside every
 * component save, so non-css paths are preferred; falls back to the first
 * path, or `null` when the list is empty.
 *
 * @example
 * ```ts
 * pickHmrSourcePath(["/src/index.css", "/src/app.tsx"]);
 * // "/src/app.tsx"
 * ```
 */
export const pickHmrSourcePath = (filePaths: string[]): string | null => {
  const sourcePath = filePaths.find((filePath) => !filePath.endsWith(".css"));
  return sourcePath ?? filePaths[0] ?? null;
};
