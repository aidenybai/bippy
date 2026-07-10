export interface StackFrame {
  args?: unknown[];
  columnNumber?: number;
  lineNumber?: number;
  // start of the enclosing function (the definition, not the call site);
  // only available from V8's structured CallSite API
  enclosingLineNumber?: number;
  enclosingColumnNumber?: number;
  fileName?: string;
  functionName?: string;
  source?: string;
  isServer?: boolean;
  isSymbolicated?: boolean;
  // the source map ignore-listed this frame's original source (x_google_ignoreList)
  isIgnoreListed?: boolean;
}

export interface ParseOptions {
  slice?: number | [number, number];
  allowEmpty?: boolean;
  includeInElement?: boolean;
}

const FIREFOX_SAFARI_STACK_REGEXP = /(^|@)\S+:\d+/;
const CHROME_IE_STACK_REGEXP = /^\s*at .*(\S+:\d+|\(native\))/m;
const SAFARI_NATIVE_CODE_REGEXP = /^(eval@)?(\[native code\])?$/;

export const parseStack = (stackString: string, options?: ParseOptions): StackFrame[] => {
  if (options?.includeInElement !== false) {
    const lines = stackString.split("\n");
    const frames: StackFrame[] = [];
    for (const rawLine of lines) {
      if (/^\s*at\s+/.test(rawLine)) {
        const parsed = parseV8OrIeString(rawLine, undefined)[0];
        if (parsed) frames.push(parsed);
      } else if (/^\s*in\s+/.test(rawLine)) {
        const elementName = rawLine.replace(/^\s*in\s+/, "").replace(/\s*\(at .*\)$/, "");
        frames.push({ functionName: elementName, source: rawLine });
      } else if (rawLine.match(FIREFOX_SAFARI_STACK_REGEXP)) {
        const parsed = parseFFOrSafariString(rawLine, undefined)[0];
        if (parsed) frames.push(parsed);
      }
    }
    return applySlice(frames, options);
  }
  if (stackString.match(CHROME_IE_STACK_REGEXP)) {
    return parseV8OrIeString(stackString, options);
  }
  return parseFFOrSafariString(stackString, options);
};

export const extractLocation = (
  urlLike: string,
): [string, string | undefined, string | undefined] => {
  if (!urlLike.includes(":")) return [urlLike, undefined, undefined];

  // HACK: Chrome/V8 stack traces wrap location in parens: "(file.js:10:5)"
  // We need to strip these outer parens but preserve parens in paths (e.g., Next.js route groups like "(docs)")
  // Chrome format always ends with `:col)` where digit comes right before the closing paren
  const isWrappedLocation = urlLike.startsWith("(") && /:\d+\)$/.test(urlLike);
  const sanitizedResult = isWrappedLocation ? urlLike.slice(1, -1) : urlLike;

  const regExp = /(.+?)(?::(\d+))?(?::(\d+))?$/;
  const parts = regExp.exec(sanitizedResult);
  if (!parts) return [sanitizedResult, undefined, undefined];
  return [parts[1], parts[2] || undefined, parts[3] || undefined] as const;
};

const applySlice = <T>(lines: T[], options?: ParseOptions): T[] => {
  if (options && options.slice != null) {
    if (Array.isArray(options.slice)) return lines.slice(options.slice[0], options.slice[1]);
    return lines.slice(0, options.slice);
  }
  return lines;
};

export const parseV8OrIeString = (stack: string, options?: ParseOptions): StackFrame[] => {
  const filteredLines = applySlice(
    stack.split("\n").filter((line) => {
      return !!line.match(CHROME_IE_STACK_REGEXP);
    }),
    options,
  );

  return filteredLines.map((line): StackFrame => {
    let currentLine = line;
    if (currentLine.includes("(eval ")) {
      currentLine = currentLine
        .replace(/eval code/g, "eval")
        .replace(/(\(eval at [^()]*)|(,.*$)/g, "");
    }
    let sanitizedLine = currentLine
      .replace(/^\s+/, "")
      .replace(/\(eval code/g, "(")
      .replace(/^.*?\s+/, "");

    const locationMatch = sanitizedLine.match(/ (\(.+\)$)/);

    sanitizedLine = locationMatch ? sanitizedLine.replace(locationMatch[0], "") : sanitizedLine;

    const locationParts = extractLocation(locationMatch ? locationMatch[1] : sanitizedLine);
    const functionName = (locationMatch && sanitizedLine) || undefined;
    const fileName = ["eval", "<anonymous>"].includes(locationParts[0])
      ? undefined
      : locationParts[0];

    return {
      functionName,
      fileName,
      lineNumber: locationParts[1] ? +locationParts[1] : undefined,
      columnNumber: locationParts[2] ? +locationParts[2] : undefined,
      source: currentLine,
    };
  });
};

export const parseFFOrSafariString = (stack: string, options?: ParseOptions): StackFrame[] => {
  const filteredLines = applySlice(
    stack.split("\n").filter((line) => {
      return !line.match(SAFARI_NATIVE_CODE_REGEXP);
    }),
    options,
  );

  return filteredLines.map((line): StackFrame => {
    let currentLine = line;
    if (currentLine.includes(" > eval"))
      currentLine = currentLine.replace(/ line (\d+)(?: > eval line \d+)* > eval:\d+:\d+/g, ":$1");

    if (!currentLine.includes("@") && !currentLine.includes(":")) {
      return {
        functionName: currentLine,
      };
    } else {
      const functionNameRegex =
        /(([^\n\r"\u2028\u2029]*".[^\n\r"\u2028\u2029]*"[^\n\r@\u2028\u2029]*(?:@[^\n\r"\u2028\u2029]*"[^\n\r@\u2028\u2029]*)*(?:[\n\r\u2028\u2029][^@]*)?)?[^@]*)@/;
      const matches = currentLine.match(functionNameRegex);
      const functionName = matches && matches[1] ? matches[1] : undefined;
      const locationParts = extractLocation(currentLine.replace(functionNameRegex, ""));

      return {
        functionName,
        fileName: locationParts[0],
        lineNumber: locationParts[1] ? +locationParts[1] : undefined,
        columnNumber: locationParts[2] ? +locationParts[2] : undefined,
        source: currentLine,
      };
    }
  });
};
