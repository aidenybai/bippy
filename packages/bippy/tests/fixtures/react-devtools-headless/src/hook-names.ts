export interface HookMapEntry {
  column: number;
  line: number;
  name: string | null;
}

export interface HookMap {
  entries: HookMapEntry[];
}

export interface EncodedHookMap {
  mappings: string;
}

export interface HookSourceLocation {
  column: number;
  hookId: number;
  line: number;
}

export interface ParsedHookName {
  hookId: number;
  name: string | null;
}

const getAssignedName = (line: string, hookColumn: number): string | null => {
  const prefix = line.slice(0, hookColumn);
  const segment = prefix
    .slice(Math.max(prefix.lastIndexOf(","), prefix.lastIndexOf(";")) + 1)
    .replace(/^\s*(?:const|let|var)\s+/, "")
    .replace(/(?:require\s*\([^)]*\)|[\w$.]+)\.\s*$/, "");
  const assignment = /^\s*(?:\[\s*)?([A-Za-z_$][\w$]*)[^=]*=\s*$/.exec(segment);
  return assignment?.[1] ?? null;
};

export const generateHookMap = (source: string): HookMap => {
  const entries: HookMapEntry[] = [{ column: 0, line: 1, name: null }];
  const lines = source.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const hookPattern = /\buse[A-Z][\w$]*\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = hookPattern.exec(line)) !== null) {
      const name = getAssignedName(line, match.index);
      if (!name) continue;
      const startColumn = match.index;
      const closingColumn = line.indexOf(")", startColumn);
      entries.push({ column: startColumn, line: lineIndex + 1, name });
      entries.push({
        column: closingColumn >= 0 ? closingColumn + 1 : startColumn + match[0].length,
        line: lineIndex + 1,
        name: null,
      });
    }
  }
  return {
    entries: entries.sort((left, right) => left.line - right.line || left.column - right.column),
  };
};

export const generateEncodedHookMap = (source: string): EncodedHookMap => ({
  mappings: JSON.stringify(generateHookMap(source).entries),
});

export const decodeHookMap = (encodedHookMap: EncodedHookMap): HookMap => ({
  entries: JSON.parse(encodedHookMap.mappings),
});

export const getHookNameForLocation = (
  location: { column: number; line: number },
  hookMap: HookMap,
): string | null => {
  let name: string | null = null;
  for (const entry of hookMap.entries) {
    if (
      entry.line > location.line ||
      (entry.line === location.line && entry.column > location.column)
    ) {
      break;
    }
    name = entry.name;
  }
  return name;
};

export const parseHookNames = (
  source: string,
  locations: HookSourceLocation[],
): ParsedHookName[] => {
  const hookMap = generateHookMap(source);
  return locations.map((location) => ({
    hookId: location.hookId,
    name: getHookNameForLocation(location, hookMap),
  }));
};
