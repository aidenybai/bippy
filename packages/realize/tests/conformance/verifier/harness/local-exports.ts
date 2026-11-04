import type { Plugin } from "vite";
import { stripQuery } from "./packages";

const LOCAL_EXPORT_PREFIX = "__bippyLocal_";

export const toLocalExportName = (name: string): string => `${LOCAL_EXPORT_PREFIX}${name}`;

const createLocalExportStatement = (names: string[]): string =>
  `\nexport { ${names.map((name) => `${name} as ${toLocalExportName(name)}`).join(", ")} };\n`;

export const createLocalExportPlugin = (localNamesByFile: Map<string, string[]>): Plugin => ({
  name: "bippy-verify-local-exports",
  transform: (code, id) => {
    const names = localNamesByFile.get(stripQuery(id));
    return names && names.length > 0 ? `${code}${createLocalExportStatement(names)}` : null;
  },
});
