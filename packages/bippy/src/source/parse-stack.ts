export interface StackFrame {
  args?: unknown[];
  columnNumber?: number;
  lineNumber?: number;
  fileName?: string;
  functionName?: string;
  source?: string;
}

export interface StackFrameLite {
  function?: string;
  args?: unknown[];
  file?: string;
  col?: number;
  line?: number;
  raw?: string;
}

export interface ParseOptions {
  slice?: number | [number, number];
  allowEmpty?: boolean;
  includeInElement?: boolean;
}

const FIREFOX_SAFARI_STACK_REGEXP = /(^|@)\S+:\d+/;
const CHROME_IE_STACK_REGEXP = /^\s*at .*(\S+:\d+|\(native\))/m;
const SAFARI_NATIVE_CODE_REGEXP = /^(eval@)?(\[native code\])?$/;

const getNonStandardStacktrace = (error: unknown): string | null => {
  if (error && typeof error === 'object') {
    const stacktrace = (error as Record<string, unknown>)['stacktrace'];
    return typeof stacktrace === 'string' ? stacktrace : null;
  }
  return null;
};

export const parseStack = (
  stackString: string,
  options?: ParseOptions,
): StackFrameLite[] => {
  if (options?.includeInElement !== false) {
    const lines = stackString.split('\n');
    const frames: StackFrameLite[] = [];
    for (const rawLine of lines) {
      if (/^\s*at\s+/.test(rawLine)) {
        const parsed = parseV8OrIeString(rawLine, undefined)[0];
        if (parsed) frames.push(parsed);
      } else if (/^\s*in\s+/.test(rawLine)) {
        const elementName = rawLine
          .replace(/^\s*in\s+/, '')
          .replace(/\s*\(at .*\)$/, '');
        frames.push({ function: elementName, raw: rawLine });
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
  // Fail-fast but return locations like "(native)"
  if (!urlLike.includes(':')) return [urlLike, undefined, undefined];

  const regExp = /(.+?)(?::(\d+))?(?::(\d+))?$/;
  const parts = regExp.exec(urlLike.replace(/[()]/g, ''))!;
  return [parts[1], parts[2] || undefined, parts[3] || undefined] as const;
};

const applySlice = <T>(lines: T[], options?: ParseOptions): T[] => {
  if (options && options.slice != null) {
    if (Array.isArray(options.slice))
      return lines.slice(options.slice[0], options.slice[1]);
    return lines.slice(0, options.slice);
  }
  return lines;
};

export const parseV8OrIE = (
  error: Error,
  options?: ParseOptions,
): StackFrameLite[] => {
  return parseV8OrIeString(error.stack!, options);
};

export const parseV8OrIeString = (
  stack: string,
  options?: ParseOptions,
): StackFrameLite[] => {
  const filteredLines = applySlice(
    stack.split('\n').filter((line) => {
      return !!line.match(CHROME_IE_STACK_REGEXP);
    }),
    options,
  );

  return filteredLines.map((line): StackFrameLite => {
    let currentLine = line;
    if (currentLine.includes('(eval ')) {
      // Throw away eval information until we implement stacktrace.js/stackframe#8
      currentLine = currentLine
        .replace(/eval code/g, 'eval')
        .replace(/(\(eval at [^()]*)|(,.*$)/g, '');
    }
    let sanitizedLine = currentLine
      .replace(/^\s+/, '')
      .replace(/\(eval code/g, '(')
      .replace(/^.*?\s+/, '');

    // capture and preseve the parenthesized location "(/foo/my bar.js:12:87)" in
    // case it has spaces in it, as the string is split on \s+ later on
    const locationMatch = sanitizedLine.match(/ (\(.+\)$)/);

    // remove the parenthesized location from the line, if it was matched
    sanitizedLine = locationMatch
      ? sanitizedLine.replace(locationMatch[0], '')
      : sanitizedLine;

    // if a location was matched, pass it to extractLocation() otherwise pass all sanitizedLine
    // because this line doesn't have function name
    const locationParts = extractLocation(
      locationMatch ? locationMatch[1] : sanitizedLine,
    );
    const functionName = (locationMatch && sanitizedLine) || undefined;
    const fileName = ['eval', '<anonymous>'].includes(locationParts[0])
      ? undefined
      : locationParts[0];

    return {
      function: functionName,
      file: fileName,
      line: locationParts[1] ? +locationParts[1] : undefined,
      col: locationParts[2] ? +locationParts[2] : undefined,
      raw: currentLine,
    };
  });
};

export const parseFFOrSafari = (
  error: Error,
  options?: ParseOptions,
): StackFrameLite[] => {
  return parseFFOrSafariString(error.stack!, options);
};

export const parseFFOrSafariString = (
  stack: string,
  options?: ParseOptions,
): StackFrameLite[] => {
  const filteredLines = applySlice(
    stack.split('\n').filter((line) => {
      return !line.match(SAFARI_NATIVE_CODE_REGEXP);
    }),
    options,
  );

  return filteredLines.map((line): StackFrameLite => {
    let currentLine = line;
    // Throw away eval information until we implement stacktrace.js/stackframe#8
    if (currentLine.includes(' > eval'))
      currentLine = currentLine.replace(
        / line (\d+)(?: > eval line \d+)* > eval:\d+:\d+/g,
        ':$1',
      );

    if (!currentLine.includes('@') && !currentLine.includes(':')) {
      // Safari eval frames only have function names and nothing else
      return {
        function: currentLine,
      };
    } else {
      const functionNameRegex =
        /(([^\n\r"\u2028\u2029]*".[^\n\r"\u2028\u2029]*"[^\n\r@\u2028\u2029]*(?:@[^\n\r"\u2028\u2029]*"[^\n\r@\u2028\u2029]*)*(?:[\n\r\u2028\u2029][^@]*)?)?[^@]*)@/;
      const matches = currentLine.match(functionNameRegex);
      const functionName = matches && matches[1] ? matches[1] : undefined;
      const locationParts = extractLocation(
        currentLine.replace(functionNameRegex, ''),
      );

      return {
        function: functionName,
        file: locationParts[0],
        line: locationParts[1] ? +locationParts[1] : undefined,
        col: locationParts[2] ? +locationParts[2] : undefined,
        raw: currentLine,
      };
    }
  });
};

export const parseOpera = (
  error: Error,
  options?: ParseOptions,
): StackFrameLite[] => {
  const nonStandardStacktrace = getNonStandardStacktrace(error);
  if (
    !nonStandardStacktrace ||
    (error.message.includes('\n') &&
      error.message.split('\n').length >
        nonStandardStacktrace.split('\n').length)
  ) {
    return parseOpera9(error, options);
  }
  if (!error.stack) return parseOpera10(error, options);
  return parseOpera11(error, options);
};

export const parseOpera9 = (
  error: Error,
  options?: ParseOptions,
): StackFrameLite[] => {
  const lineRegex = /Line (\d+).*script (?:in )?(\S+)/i;
  const messageLines = error.message.split('\n');
  const parsedFrames: StackFrameLite[] = [];

  for (let i = 2, len = messageLines.length; i < len; i += 2) {
    const match = lineRegex.exec(messageLines[i]);
    if (match) {
      parsedFrames.push({
        file: match[2],
        line: +match[1],
        raw: messageLines[i],
      });
    }
  }

  return applySlice(parsedFrames, options);
};

export const parseOpera10 = (
  error: Error,
  options?: ParseOptions,
): StackFrameLite[] => {
  const lineRegex =
    /Line (\d+).*script (?:in )?(\S+)(?:: In function (\S+))?$/i;
  const nonStandardStacktrace = getNonStandardStacktrace(error);
  const stacktraceLines = (nonStandardStacktrace || '').split('\n');
  const parsedFrames: StackFrameLite[] = [];

  for (let i = 0, len = stacktraceLines.length; i < len; i += 2) {
    const match = lineRegex.exec(stacktraceLines[i]);
    if (match) {
      parsedFrames.push({
        function: match[3] || undefined,
        file: match[2],
        line: match[1] ? +match[1] : undefined,
        raw: stacktraceLines[i],
      });
    }
  }

  return applySlice(parsedFrames, options);
};

// Opera 10.65+ Error.stack very similar to FF/Safari
export const parseOpera11 = (
  error: Error,
  options?: ParseOptions,
): StackFrameLite[] => {
  const filteredLines = applySlice(
    // @ts-expect-error missing stack property
    error.stack.split('\n').filter((line) => {
      return (
        !!line.match(FIREFOX_SAFARI_STACK_REGEXP) &&
        !line.match(/^Error created at/)
      );
    }),
    options,
  );

  return filteredLines.map<StackFrameLite>((line) => {
    const tokens = line.split('@');
    const locationParts = extractLocation(tokens.pop()!);
    const functionCall = tokens.shift() || '';
    const functionName =
      functionCall
        .replace(/<anonymous function(: (\w+))?>/, '$2')
        .replace(/\([^)]*\)/g, '') || undefined;
    let argsRaw: string | undefined;
    if (functionCall.match(/\(([^)]*)\)/))
      argsRaw = functionCall.replace(/^[^(]+\(([^)]*)\)$/, '$1');

    const args =
      argsRaw === undefined || argsRaw === '[arguments not available]'
        ? undefined
        : argsRaw.split(',');

    return {
      function: functionName,
      args,
      file: locationParts[0],
      line: locationParts[1] ? +locationParts[1] : undefined,
      col: locationParts[2] ? +locationParts[2] : undefined,
      raw: line,
    };
  });
};
