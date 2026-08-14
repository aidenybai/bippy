import type { HooksNode, HooksTree, HookSource } from "./inspect-hooks.js";
import {
  getSourceContentFromSourceMap,
  getSourceFromSourceMap,
  getSourceMap,
  type SourceFetch,
} from "./symbolication.js";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HookNames extends Map<string, string> {}

const UNNAMED_HOOKS = new Set([
  "Effect",
  "LayoutEffect",
  "InsertionEffect",
  "ImperativeHandle",
  "DebugValue",
]);

// HACK: matches `const/let/var [name, ...] = use...(...` or `const/let/var name = use...(...`
// across up to 10 lines; handles TypeScript generics like `useState<T>(`
const HOOK_DECLARATION_REGEX =
  /(?:const|let|var)\s+((?:\[[\s\S]*?\]|\w+))\s*=\s*(?:[\w$.]+\.)*use[A-Z]\w*\s*(?:<[\s\S]*?>)?\s*\(/g;

export const getHookSourceLocationKey = (hookSource: HookSource): string =>
  `${hookSource.fileName ?? ""}:${hookSource.lineNumber ?? 0}:${hookSource.columnNumber ?? 0}`;

const flattenHooksTree = (hooksTree: HooksTree): HooksNode[] => {
  const hooksList: HooksNode[] = [];
  const collectNamedHooks = (tree: HooksTree): void => {
    for (const hook of tree) {
      if (UNNAMED_HOOKS.has(hook.name)) continue;
      hooksList.push(hook);
      if (hook.subHooks.length > 0) collectNamedHooks(hook.subHooks);
    }
  };
  collectNamedHooks(hooksTree);
  return hooksList;
};

const extractVariableNameFromBinding = (binding: string): string | null => {
  const trimmed = binding.trim();
  if (trimmed.startsWith("[")) {
    const match = trimmed.match(/\[\s*(\w+)/);
    return match ? match[1] : null;
  }
  return /^\w+$/.test(trimmed) ? trimmed : null;
};

export const extractHookVariableName = (
  sourceCode: string,
  lineNumber: number,
  columnNumber: number,
): string | null => {
  const lines = sourceCode.split("\n");
  const hookLineIndex = lineNumber - 1;

  if (hookLineIndex < 0 || hookLineIndex >= lines.length) return null;

  const searchStartLine = Math.max(0, hookLineIndex - 10);
  const chunkLines = lines.slice(searchStartLine, hookLineIndex + 1);
  const sourceChunk = chunkLines.join("\n");

  const allMatches = [...sourceChunk.matchAll(HOOK_DECLARATION_REGEX)];

  const hookPositionInChunk = sourceChunk.lastIndexOf("\n") + 1 + columnNumber;
  const closestMatch = allMatches.filter((match) => match.index! <= hookPositionInChunk).at(-1);

  if (closestMatch) {
    return extractVariableNameFromBinding(closestMatch[1]);
  }

  return null;
};

interface ResolvedSource {
  sourceCode: string;
  lineNumber: number;
  columnNumber: number;
}

interface SourceResolutionContext {
  sourceContentCache: Map<string, string | null>;
  fetchFn?: SourceFetch;
}

const resolveOriginalSource = async (
  runtimeFileName: string,
  runtimeLine: number,
  runtimeColumn: number,
  context: SourceResolutionContext,
): Promise<ResolvedSource | null> => {
  const { sourceContentCache, fetchFn } = context;

  const sourceMap = await getSourceMap(runtimeFileName, true, fetchFn);

  if (sourceMap) {
    const originalLocation = getSourceFromSourceMap(sourceMap, runtimeLine, runtimeColumn);
    if (originalLocation?.fileName && originalLocation.lineNumber !== undefined) {
      const originalSourceCode = getSourceContentFromSourceMap(
        sourceMap,
        originalLocation.fileName,
      );
      if (originalSourceCode) {
        return {
          sourceCode: originalSourceCode,
          lineNumber: originalLocation.lineNumber,
          columnNumber: originalLocation.columnNumber ?? 0,
        };
      }
    }
  }

  if (!sourceContentCache.has(runtimeFileName)) {
    try {
      const fetchImpl = fetchFn ?? fetch;
      const response = await fetchImpl(runtimeFileName);
      sourceContentCache.set(runtimeFileName, response.ok ? await response.text() : null);
    } catch {
      sourceContentCache.set(runtimeFileName, null);
    }
  }

  const runtimeSourceCode = sourceContentCache.get(runtimeFileName) ?? null;
  if (runtimeSourceCode) {
    return {
      sourceCode: runtimeSourceCode,
      lineNumber: runtimeLine,
      columnNumber: runtimeColumn,
    };
  }

  return null;
};

export const parseHookNames = async (
  hooksTree: HooksTree,
  fetchFn?: SourceFetch,
): Promise<HookNames> => {
  const hookNames: HookNames = new Map();
  const hooksList = flattenHooksTree(hooksTree);

  if (hooksList.length === 0) return hookNames;

  const resolutionContext: SourceResolutionContext = {
    sourceContentCache: new Map(),
    fetchFn,
  };

  await Promise.all(
    hooksList.map(async (hook) => {
      const hookSource = hook.hookSource;
      if (
        !hookSource ||
        !hookSource.fileName ||
        hookSource.lineNumber === null ||
        hookSource.columnNumber === null
      ) {
        return;
      }

      const resolved = await resolveOriginalSource(
        hookSource.fileName,
        hookSource.lineNumber,
        hookSource.columnNumber,
        resolutionContext,
      );

      if (!resolved) return;

      const variableName = extractHookVariableName(
        resolved.sourceCode,
        resolved.lineNumber,
        resolved.columnNumber,
      );

      if (variableName) {
        const locationKey = getHookSourceLocationKey(hookSource);
        hookNames.set(locationKey, variableName);
      }
    }),
  );

  return hookNames;
};
