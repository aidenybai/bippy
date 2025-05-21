import { parseStack } from 'error-stack-parser-es/lite';
import { type RawSourceMap, SourceMapConsumer } from 'source-map-js';
import type { Fiber } from './types.js';
import {
  ClassComponentTag,
  getType,
  isCompositeFiber,
  isHostFiber,
  traverseFiber,
  getDisplayName,
  _renderers,
  getRDTHook,
} from './index.js';

export interface FiberSource {
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
  const source = parseStack(frame);

  if (!source.length) {
    return null;
  }

  const { file: fileName, line: lineNumber, col: columnNumber = 0 } = source[0];

  if (!fileName || !lineNumber) {
    return null;
  }

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
        fileName: sourcemap.file || result.source,
        lineNumber: result.line,
        columnNumber: result.column,
      };
    }
  }
  return {
    fileName,
    lineNumber,
    columnNumber,
  };
};

// https://github.com/facebook/react/blob/f739642745577a8e4dcb9753836ac3589b9c590a/packages/react-devtools-shared/src/backend/shared/DevToolsComponentStackFrame.js#L22
const describeNativeComponentFrame = (
  fn: React.ComponentType<unknown>,
  construct: boolean
): string => {
  if (!fn || reentry) {
    return '';
  }

  const previousPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = undefined;
  reentry = true;

  const previousDispatcher = getCurrentDispatcher();
  setCurrentDispatcher(null);
  const prevLogs = disableLogs();
  try {
    /**
     * Finding a common stack frame between sample and control errors can be
     * tricky given the different types and levels of stack trace truncation from
     * different JS VMs. So instead we'll attempt to control what that common
     * frame should be through this object method:
     * Having both the sample and control errors be in the function under the
     * `DescribeNativeComponentFrameRoot` property, + setting the `name` and
     * `displayName` properties of the function ensures that a stack
     * frame exists that has the method name `DescribeNativeComponentFrameRoot` in
     * it for both control and sample stacks.
     */
    const RunInRootFrame = {
      DetermineComponentFrameRoot() {
        // biome-ignore lint/suspicious/noExplicitAny: OK
        let control: any;
        try {
          // This should throw.
          if (construct) {
            // Something should be setting the props in the constructor.
            // biome-ignore lint/complexity/useArrowFunction: OK
            const Fake = function () {
              throw Error();
            };
            // $FlowFixMe[prop-missing]
            Object.defineProperty(Fake.prototype, 'props', {
              // biome-ignore lint/complexity/useArrowFunction: OK
              set: function () {
                // We use a throwing setter instead of frozen or non-writable props
                // because that won't throw in a non-strict mode function.
                throw Error();
              },
            });
            if (typeof Reflect === 'object' && Reflect.construct) {
              // We construct a different control for this case to include any extra
              // frames added by the construct call.
              try {
                Reflect.construct(Fake, []);
              } catch (x) {
                control = x;
              }
              Reflect.construct(fn, [], Fake);
            } else {
              try {
                // @ts-expect-error
                Fake.call();
              } catch (x) {
                control = x;
              }
              // @ts-expect-error
              fn.call(Fake.prototype);
            }
          } else {
            try {
              throw Error();
            } catch (x) {
              control = x;
            }
            // TODO(luna): This will currently only throw if the function component
            // tries to access React/ReactDOM/props. We should probably make this throw
            // in simple components too
            // @ts-expect-error
            const maybePromise = fn();

            // If the function component returns a promise, it's likely an async
            // component, which we don't yet support. Attach a noop catch handler to
            // silence the error.
            // TODO: Implement component stacks for async client components?
            if (maybePromise && typeof maybePromise.catch === 'function') {
              maybePromise.catch(() => {});
            }
          }
          // biome-ignore lint/suspicious/noExplicitAny: OK
        } catch (sample: any) {
          // This is inlined manually because closure doesn't do it for us.
          if (sample && control && typeof sample.stack === 'string') {
            return [sample.stack, control.stack];
          }
        }
        return [null, null];
      },
    };

    // @ts-expect-error
    RunInRootFrame.DetermineComponentFrameRoot.displayName =
      'DetermineComponentFrameRoot';
    const namePropDescriptor = Object.getOwnPropertyDescriptor(
      RunInRootFrame.DetermineComponentFrameRoot,
      'name'
    );
    // Before ES6, the `name` property was not configurable.
    if (namePropDescriptor?.configurable) {
      // V8 utilizes a function's `name` property when generating a stack trace.
      Object.defineProperty(
        RunInRootFrame.DetermineComponentFrameRoot,
        // Configurable properties can be updated even if its writable descriptor
        // is set to `false`.
        // $FlowFixMe[cannot-write]
        'name',
        { value: 'DetermineComponentFrameRoot' }
      );
    }

    const [sampleStack, controlStack] =
      RunInRootFrame.DetermineComponentFrameRoot();
    if (sampleStack && controlStack) {
      // This extracts the first frame from the sample that isn't also in the control.
      // Skipping one frame that we assume is the frame that calls the two.
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
      // We couldn't find our intentionally injected common root frame, attempt
      // to find another common root frame by search from the bottom of the
      // control stack...
      if (s === sampleLines.length || c === controlLines.length) {
        s = sampleLines.length - 1;
        c = controlLines.length - 1;
        while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) {
          // We expect at least one stack frame to be shared.
          // Typically this will be the root most one. However, stack frames may be
          // cut off due to maximum stack limits. In this case, one maybe cut off
          // earlier than the other. We assume that the sample is longer or the same
          // and there for cut off earlier. So we should find the root most frame in
          // the sample somewhere in the control.
          c--;
        }
      }
      for (; s >= 1 && c >= 0; s--, c--) {
        // Next we find the first one that isn't the same which should be the
        // frame that called our sample function and the control.
        if (sampleLines[s] !== controlLines[c]) {
          // In V8, the first line is describing the message but other VMs don't.
          // If we're about to return the first line, and the control is also on the same
          // line, that's a pretty good indicator that our sample threw at same line as
          // the control. I.e. before we entered the sample frame. So we ignore this result.
          // This can happen if you passed a class to function component, or non-function.
          if (s !== 1 || c !== 1) {
            do {
              s--;
              c--;
              // We may still have similar intermediate frames from the construct call.
              // The next one that isn't the same should be our match though.
              if (c < 0 || sampleLines[s] !== controlLines[c]) {
                // V8 adds a "new" prefix for native classes. Let's remove it to make it prettier.
                let frame = `\n${sampleLines[s].replace(' at new ', ' at ')}`;

                const displayName = getDisplayName(fn);
                // If our component frame is labeled "<anonymous>"
                // but we have a user-provided "displayName"
                // splice it in to make the stack more readable.
                if (displayName && frame.includes('<anonymous>')) {
                  frame = frame.replace('<anonymous>', displayName);
                }
                // Return the line we found.
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

    setCurrentDispatcher(previousDispatcher);
    reenableLogs(prevLogs);
  }

  const name = fn ? getDisplayName(fn) : '';
  const syntheticFrame = name ? describeBuiltInComponentFrame(name) : '';
  return syntheticFrame;
};

export const getCurrentDispatcher = (): React.RefObject<unknown> | null => {
  const rdtHook = getRDTHook();
  for (const renderer of [
    ...Array.from(_renderers),
    ...Array.from(rdtHook.renderers.values()),
  ]) {
    const currentDispatcherRef = renderer.currentDispatcherRef;
    if (currentDispatcherRef) {
      // @ts-expect-error
      return currentDispatcherRef.H || currentDispatcherRef.current;
    }
  }
  return null;
};

export const setCurrentDispatcher = (
  value: React.RefObject<unknown> | null
): void => {
  for (const renderer of _renderers) {
    const currentDispatcherRef = renderer.currentDispatcherRef;
    if (currentDispatcherRef) {
      if ('H' in currentDispatcherRef) {
        currentDispatcherRef.H = value;
      } else {
        currentDispatcherRef.current = value;
      }
    }
  }
};

export const getFiberSource = async (
  fiber: Fiber
): Promise<FiberSource | null> => {
  const debugSource = fiber._debugSource;
  if (debugSource) {
    const { fileName, lineNumber } = debugSource;
    return {
      fileName,
      lineNumber,
      columnNumber:
        'columnNumber' in debugSource &&
        typeof debugSource.columnNumber === 'number'
          ? debugSource.columnNumber
          : 0,
    };
  }

  // passed by bippy's jsx-dev-runtime
  if (fiber.memoizedProps?.__source) {
    return fiber.memoizedProps.__source as FiberSource;
  }

  const currentDispatcherRef = getCurrentDispatcher();

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
          true
        )?.type
      )
    : getType(fiber.type);
  if (!componentFunction || reentry) {
    return null;
  }

  const frame = describeNativeComponentFrame(
    componentFunction,
    fiber.tag === ClassComponentTag
  );
  return parseStackFrame(frame);
};

export * from './index.js';
