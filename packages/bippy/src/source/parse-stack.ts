export interface StackFrame {
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
        if (CHROME_IE_STACK_REGEXP.test(rawLine)) frames.push(parseV8Line(rawLine));
      } else if (/^\s*in\s+/.test(rawLine)) {
        const elementName = rawLine
          .replace(/^\s*in\s+/, "")
          .replace(/\s*(?:\(at .*\)|\[[^\]]+\])$/, "");
        frames.push({ functionName: elementName, source: rawLine });
      } else if (rawLine.match(FIREFOX_SAFARI_STACK_REGEXP)) {
        if (!SAFARI_NATIVE_CODE_REGEXP.test(rawLine)) frames.push(parseSafariLine(rawLine));
      }
    }
    return frames;
  }
  if (stackString.match(CHROME_IE_STACK_REGEXP)) {
    return parseV8OrIeString(stackString);
  }
  return parseFFOrSafariString(stackString);
};

const getPositionIndex = (location: string, endIndex: number): number => {
  let positionIndex = endIndex - 1;
  while (positionIndex >= 0) {
    const character = location.charCodeAt(positionIndex);
    if (character < 48 || character > 57) break;
    positionIndex--;
  }
  return positionIndex < endIndex - 1 && location.charCodeAt(positionIndex) === 58
    ? positionIndex
    : -1;
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

  if (/[\n\r\u2028\u2029]/.test(sanitizedResult)) {
    const parts = /(.+?)(?::(\d+))?(?::(\d+))?$/.exec(sanitizedResult);
    return parts
      ? [parts[1], parts[2] || undefined, parts[3] || undefined]
      : [sanitizedResult, undefined, undefined];
  }

  const lastPositionIndex = getPositionIndex(sanitizedResult, sanitizedResult.length);
  if (lastPositionIndex <= 0) return [sanitizedResult, undefined, undefined];
  const previousPositionIndex = getPositionIndex(sanitizedResult, lastPositionIndex);
  if (previousPositionIndex <= 0) {
    return [
      sanitizedResult.slice(0, lastPositionIndex),
      sanitizedResult.slice(lastPositionIndex + 1),
      undefined,
    ];
  }
  return [
    sanitizedResult.slice(0, previousPositionIndex),
    sanitizedResult.slice(previousPositionIndex + 1, lastPositionIndex),
    sanitizedResult.slice(lastPositionIndex + 1),
  ];
};

const parseV8Line = (line: string): StackFrame => {
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
  const fileName = ["eval", "<anonymous>", "(native)"].includes(locationParts[0])
    ? undefined
    : locationParts[0];

  return {
    functionName,
    fileName,
    lineNumber: locationParts[1] ? +locationParts[1] : undefined,
    columnNumber: locationParts[2] ? +locationParts[2] : undefined,
    source: currentLine,
  };
};

const parseSafariLine = (line: string): StackFrame => {
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
};

const parseLines = (
  stack: string,
  isV8: boolean,
  cache?: Map<string, StackFrame>,
): StackFrame[] => {
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    let frame = cache?.get(line);
    if (!frame) {
      if (isV8 ? !CHROME_IE_STACK_REGEXP.test(line) : SAFARI_NATIVE_CODE_REGEXP.test(line))
        continue;
      frame = isV8 ? parseV8Line(line) : parseSafariLine(line);
      cache?.set(line, frame);
    }
    frames.push(frame);
  }
  return frames;
};

export const parseV8OrIeString = (stack: string): StackFrame[] => parseLines(stack, true);

export const parseFFOrSafariString = (stack: string): StackFrame[] => parseLines(stack, false);

export const createStackParser = () => {
  const v8Frames = new Map<string, StackFrame>();
  const safariFrames = new Map<string, StackFrame>();
  return (stack: string): StackFrame[] => {
    const isV8 = CHROME_IE_STACK_REGEXP.test(stack);
    return parseLines(stack, isV8, isV8 ? v8Frames : safariFrames);
  };
};
