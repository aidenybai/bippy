import * as errorStackParser from 'error-stack-parser-es/lite';
import { type RawSourceMap, SourceMapConsumer } from 'source-map-js';
import type { Fiber } from './types.js';
import {
  ClassComponentTag,
  getType,
  isCompositeFiber,
  isHostFiber,
  traverseFiber,
  getRDTHook,
  getDisplayName,
} from './index.js';

interface FiberSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

let reentry = false;

const describeBuiltInComponentFrame = (name: string): string => {
  return `\n    in ${name}`;
};

const disableLogs = () => {
  const prev = {
    error: console.error,
    warn: console.warn,
  };
  console.error = () => {};
  console.warn = () => {};
  return prev;
};

const reenableLogs = (prev: {
  error: typeof console.error;
  warn: typeof console.warn;
}) => {
  console.error = prev.error;
  console.warn = prev.warn;
};

const INLINE_SOURCEMAP_REGEX = /^data:application\/json[^,]+base64,/;
const SOURCEMAP_REGEX =
  /(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"]+?)[ \t]*$)|(?:\/\*[@#][ \t]+sourceMappingURL=([^*]+?)[ \t]*(?:\*\/)[ \t]*$)/;

const getSourceMap = async (url: string, content: string) => {
  const lines = content.split('\n');
  let sourceMapUrl: string | undefined;
  for (let i = lines.length - 1; i >= 0 && !sourceMapUrl; i--) {
    const result = lines[i].match(SOURCEMAP_REGEX);
    if (result) {
      sourceMapUrl = result[1];
    }
  }

  if (!sourceMapUrl) {
    return null;
  }

  if (
    !(INLINE_SOURCEMAP_REGEX.test(sourceMapUrl) || sourceMapUrl.startsWith('/'))
  ) {
    const parsedURL = url.split('/');
    parsedURL[parsedURL.length - 1] = sourceMapUrl;
    sourceMapUrl = parsedURL.join('/');
  }
  const response = await fetch(sourceMapUrl);
  const rawSourceMap: RawSourceMap = await response.json();

  return new SourceMapConsumer(rawSourceMap);
};

const getActualFileSource = (path: string): string => {
  if (path.startsWith('file://')) {
    return `/_build/@fs${path.substring('file://'.length)}`;
  }
  return path;
};

const parseStackFrame = async (frame: string): Promise<FiberSource | null> => {
  const source = errorStackParser.parseStack(frame);

  if (!source.length) {
    return null;
  }

  const { file, line, col } = source[0];

  if (!file || !line) {
    return null;
  }

  const fileName = file || '';
  const lineNumber = line || 0;
  const columnNumber = col || 0;

  const response = await fetch(getActualFileSource(fileName));
  if (response.ok) {
    const content = await response.text();
    const sourcemap = await getSourceMap(fileName, content);

    if (sourcemap) {
      const result = sourcemap.originalPositionFor({
        line: lineNumber,
        column: columnNumber,
      });
      return {
        fileName: result.source || '',
        lineNumber: result.line || 0,
        columnNumber: result.column || 0,
      };
    }
  }
  return {
    fileName,
    lineNumber,
    columnNumber,
  };
};

// https://github.com/hoxyq/react/blob/e450e6b97653fc5b7a56ec700e87546abfd91aa3/packages/react-devtools-shared/src/backend/DevToolsComponentStackFrame.js#L67
const describeNativeComponentFrame = (
  fn: React.ComponentType<unknown>,
  construct: boolean,
  currentDispatcherRef: React.MutableRefObject<unknown>,
): string => {
  if (!fn || reentry) {
    return '';
  }

  const previousPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = undefined;
  reentry = true;

  const previousDispatcher = currentDispatcherRef.current;
  currentDispatcherRef.current = null;
  const prevLogs = disableLogs();

  const RunInRootFrame = {
    DetermineComponentFrameRoot(): [string | null, string | null] {
      let control: Error | undefined;
      try {
        if (construct) {
          const Fake = () => {
            throw Error();
          };
          Object.defineProperty(Fake.prototype, 'props', {
            set: () => {
              throw Error();
            },
          });
          if (typeof Reflect === 'object' && Reflect.construct) {
            try {
              Reflect.construct(Fake, []);
            } catch (x) {
              control = x as Error;
            }
            Reflect.construct(fn as new () => unknown, [], Fake);
          } else {
            try {
              Fake.call(null);
            } catch (x) {
              control = x as Error;
            }
            (fn as new () => unknown).call(Fake.prototype);
          }
        } else {
          try {
            throw Error();
          } catch (x) {
            control = x as Error;
          }
          const maybePromise = (fn as () => unknown)();

          if (
            maybePromise &&
            typeof maybePromise === 'object' &&
            'catch' in maybePromise &&
            typeof maybePromise.catch === 'function'
          ) {
            maybePromise.catch(() => {});
          }
        }
      } catch (sample) {
        if (
          sample instanceof Error &&
          control &&
          control.stack &&
          sample.stack
        ) {
          return [sample.stack, control.stack];
        }
      }
      return [null, null];
    },
  };

  (
    RunInRootFrame.DetermineComponentFrameRoot as React.ComponentType<unknown>
  ).displayName = 'DetermineComponentFrameRoot';
  const namePropDescriptor = Object.getOwnPropertyDescriptor(
    RunInRootFrame.DetermineComponentFrameRoot,
    'name',
  );
  if (namePropDescriptor?.configurable) {
    Object.defineProperty(RunInRootFrame.DetermineComponentFrameRoot, 'name', {
      value: 'DetermineComponentFrameRoot',
    });
  }

  try {
    const [sampleStack, controlStack] =
      RunInRootFrame.DetermineComponentFrameRoot();
    if (sampleStack && controlStack) {
      const sampleLines = sampleStack.split('\n');
      const controlLines = controlStack.split('\n');
      let s = 0;
      let c = 0;
      while (
        s < sampleLines.length &&
        !sampleLines[s].includes('DetermineComponentFrameRoot')
      ) {
        s++;
      }
      while (
        c < controlLines.length &&
        !controlLines[c].includes('DetermineComponentFrameRoot')
      ) {
        c++;
      }
      if (s === sampleLines.length || c === controlLines.length) {
        s = sampleLines.length - 1;
        c = controlLines.length - 1;
        while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) {
          c--;
        }
      }
      for (; s >= 1 && c >= 0; s--, c--) {
        if (sampleLines[s] !== controlLines[c]) {
          if (s !== 1 || c !== 1) {
            do {
              s--;
              c--;
              if (c < 0 || sampleLines[s] !== controlLines[c]) {
                // biome-ignore lint/style/useTemplate: <explanation>
                let frame = '\n' + sampleLines[s].replace(' at new ', ' at ');
                const displayName = getDisplayName(fn);
                if (displayName && frame.includes('<anonymous>')) {
                  frame = frame.replace('<anonymous>', displayName);
                }
                return frame;
              }
            } while (s >= 1 && c >= 0);
          }
          break;
        }
      }
    }
  } finally {
    reentry = false;
    Error.prepareStackTrace = previousPrepareStackTrace;
    currentDispatcherRef.current = previousDispatcher;
    reenableLogs(prevLogs);
  }

  const name = fn ? getDisplayName(fn) : '';
  const syntheticFrame = name ? describeBuiltInComponentFrame(name) : '';
  return syntheticFrame;
};

export const getFiberSource = async (
  fiber: Fiber,
): Promise<FiberSource | null> => {
  if (fiber._debugSource) {
    const { fileName, lineNumber } = fiber._debugSource;
    return {
      fileName,
      lineNumber,
      columnNumber:
        'columnNumber' in fiber._debugSource &&
        typeof fiber._debugSource.columnNumber === 'number'
          ? fiber._debugSource.columnNumber
          : 0,
    };
  }

  const rdtHook = getRDTHook();
  let currentDispatcherRef: React.MutableRefObject<unknown> | undefined;
  for (const renderer of rdtHook.renderers.values()) {
    // biome-ignore lint/suspicious/noExplicitAny: OK
    currentDispatcherRef = (renderer as any).currentDispatcherRef;
    if (currentDispatcherRef) {
      break;
    }
  }
  if (!currentDispatcherRef) {
    return null;
  }

  const componentFunction = isHostFiber(fiber)
    ? getType(
        traverseFiber(
          fiber,
          (f) => {
            if (isCompositeFiber(f)) return true;
          },
          true,
        ),
      )
    : getType(fiber.type);
  if (!componentFunction || reentry) {
    return null;
  }

  const frame = describeNativeComponentFrame(
    componentFunction,
    fiber.tag === ClassComponentTag,
    currentDispatcherRef,
  );
  return parseStackFrame(frame);
};
