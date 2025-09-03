import { parseStack } from 'error-stack-parser-es/lite';
import { type RawSourceMap, SourceMapConsumer } from 'source-map-js';
import type * as React from 'react';
import type { Fiber } from './types.js';
import {
  ClassComponentTag,
  FunctionComponentTag,
  ForwardRefTag,
  SimpleMemoComponentTag,
  HostComponentTag,
  SuspenseComponentTag,
  HostHoistableTag,
  HostSingletonTag,
  LazyComponentTag,
  SuspenseListComponentTag,
  ActivityComponentTag,
  ViewTransitionComponentTag,
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

export const describeBuiltInComponentFrame = (name: string): string => {
  return `\n    in ${name}`;
};

export const disableLogs = () => {
  const prev = {
    error: console.error,
    warn: console.warn,
  };
  console.error = () => {};
  console.warn = () => {};
  return prev;
};

export const reenableLogs = (prev: {
  error: typeof console.error;
  warn: typeof console.warn;
}) => {
  console.error = prev.error;
  console.warn = prev.warn;
};

const INLINE_SOURCEMAP_REGEX = /^data:application\/json[^,]+base64,/;
const SOURCEMAP_REGEX =
  /(?:\/\/[@#][ \t]+sourceMappingURL=([^\s'"]+?)[ \t]*$)|(?:\/\*[@#][ \t]+sourceMappingURL=([^*]+?)[ \t]*(?:\*\/)[ \t]*$)/;

export const getSourceMap = async (url: string, content: string) => {
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

export const getRemovedFileProtocolPath = (path: string): string => {
  const protocol = 'file://';
  if (path.startsWith(protocol)) {
    return path.substring(protocol.length);
  }
  return path;
};

export const parseStackFrame = async (
  frame: string
): Promise<FiberSource | null> => {
  const source = parseStack(frame);

  if (!source.length) {
    return null;
  }

  const { file: fileName, line: lineNumber, col: columnNumber = 0 } = source[0];

  if (!fileName || !lineNumber) {
    return null;
  }

  const response = await fetch(fileName);
  if (response.ok) {
    const content = await response.text();
    const sourcemap = await getSourceMap(fileName, content);

    if (sourcemap) {
      const result = sourcemap.originalPositionFor({
        line: lineNumber,
        column: columnNumber,
      });

      return {
        fileName: getRemovedFileProtocolPath(sourcemap.file || result.source),
        lineNumber: result.line,
        columnNumber: result.column,
      };
    }
  }
  return {
    fileName: getRemovedFileProtocolPath(fileName),
    lineNumber,
    columnNumber,
  };
};

// https://github.com/facebook/react/blob/f739642745577a8e4dcb9753836ac3589b9c590a/packages/react-devtools-shared/src/backend/shared/DevToolsComponentStackFrame.js#L22
export const describeNativeComponentFrame = (
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
    if (currentDispatcherRef && typeof currentDispatcherRef === 'object') {
      return 'H' in currentDispatcherRef
        ? currentDispatcherRef.H
        : currentDispatcherRef.current;
    }
  }
  return null;
};

export const setCurrentDispatcher = (
  value: React.RefObject<unknown> | null
): void => {
  for (const renderer of _renderers) {
    const currentDispatcherRef = renderer.currentDispatcherRef;
    if (currentDispatcherRef && typeof currentDispatcherRef === 'object') {
      if ('H' in currentDispatcherRef) {
        currentDispatcherRef.H = value;
      } else {
        currentDispatcherRef.current = value;
      }
    }
  }
};

// https://github.com/facebook/react/blob/main/packages/react-devtools-shared/src/backend/shared/DevToolsOwnerStack.js#L12
export const formatOwnerStack = (error: Error): string => {
  const prevPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = undefined;
  let stack = error.stack;
  if (!stack) {
    return '';
  }
  Error.prepareStackTrace = prevPrepareStackTrace;

  if (stack.startsWith('Error: react-stack-top-frame\n')) {
    // V8's default formatting prefixes with the error message which we
    // don't want/need.
    stack = stack.slice(29);
  }
  let idx = stack.indexOf('\n');
  if (idx !== -1) {
    // Pop the JSX frame.
    stack = stack.slice(idx + 1);
  }
  idx = stack.indexOf('react_stack_bottom_frame');
  if (idx === -1) {
    idx = stack.indexOf('react-stack-bottom-frame');
  }
  if (idx !== -1) {
    idx = stack.lastIndexOf('\n', idx);
  }
  if (idx !== -1) {
    // Cut off everything after the bottom frame since it'll be internals.
    stack = stack.slice(0, idx);
  } else {
    // We didn't find any internal callsite out to user space.
    // This means that this was called outside an owner or the owner is fully internal.
    // To keep things light we exclude the entire trace in this case.
    return '';
  }
  return stack;
};

export const getFiberStackFrame = (fiber: Fiber): string | null => {
  const debugStack = fiber._debugStack;
  // react 19
  if (debugStack instanceof Error && typeof debugStack?.stack === 'string') {
    const frame = formatOwnerStack(debugStack);
    if (frame) return frame;
  }

  const currentDispatcherRef = getCurrentDispatcher();

  if (!currentDispatcherRef) {
    return null;
  }

  const componentFunction = isHostFiber(fiber)
    ? getType(
        traverseFiber(
          fiber,
          (innerFiber) => {
            if (isCompositeFiber(innerFiber)) return true;
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
  return frame;
};

export const getFiberSource = async (
  fiber: Fiber
): Promise<FiberSource | null> => {
  // only available in react <18
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

  try {
    const stackFrame = getFiberStackFrame(fiber);
    if (stackFrame) {
      return await parseStackFrame(stackFrame);
    }
  } catch {}

  return null;
};

// https://github.com/facebook/react/blob/ac3e705a18696168acfcaed39dce0cfaa6be8836/packages/react-reconciler/src/ReactFiberComponentStack.js#L180
export const describeFiber = (
  fiber: Fiber,
  childFiber: null | Fiber
): string => {
  const tag = fiber.tag as number;
  switch (tag) {
    case HostHoistableTag:
    case HostSingletonTag:
    case HostComponentTag:
      return describeBuiltInComponentFrame(fiber.type as string);
    case LazyComponentTag:
      // TODO: When we support Thenables as component types we should rename this.
      return describeBuiltInComponentFrame('Lazy');
    case SuspenseComponentTag:
      if (fiber.child !== childFiber && childFiber !== null) {
        // If we came from the second Fiber then we're in the Suspense Fallback.
        return describeBuiltInComponentFrame('Suspense Fallback');
      }
      return describeBuiltInComponentFrame('Suspense');
    case SuspenseListComponentTag:
      return describeBuiltInComponentFrame('SuspenseList');
    case FunctionComponentTag:
    case SimpleMemoComponentTag:
      return describeFunctionComponentFrame(fiber.type);
    case ForwardRefTag:
      return describeFunctionComponentFrame(
        (fiber.type as { render: React.ComponentType<unknown> }).render
      );
    case ClassComponentTag:
      return describeClassComponentFrame(fiber.type);
    case ActivityComponentTag:
      return describeBuiltInComponentFrame('Activity');
    case ViewTransitionComponentTag:
      // Note: enableViewTransition feature flag is not available in this codebase,
      // so we'll always include ViewTransition
      return describeBuiltInComponentFrame('ViewTransition');
    default:
      return '';
  }
};

export const describeFunctionComponentFrame = (
  fn: React.ComponentType<unknown>
): string => {
  if (!fn || reentry) {
    return '';
  }
  return describeNativeComponentFrame(fn, false);
};

export const describeClassComponentFrame = (
  fn: React.ComponentType<unknown>
): string => {
  if (!fn || reentry) {
    return '';
  }
  return describeNativeComponentFrame(fn, true);
};

export const describeDebugInfoFrame = (
  name: string,
  env?: string,
  _debugLocation?: unknown
): string => {
  let result = `\n    in ${name}`;
  if (env) {
    result += ` (at ${env})`;
  }
  return result;
};

export const getFiberStackTrace = (workInProgress: Fiber): string => {
  try {
    let info = '';
    let node: Fiber | null = workInProgress;
    let previous: null | Fiber = null;
    do {
      info += describeFiber(node, previous);

      // Add any Server Component stack frames in reverse order (dev only).
      // Since we don't have __DEV__ in this codebase, we'll check for _debugInfo
      const debugInfo = node._debugInfo;
      if (debugInfo && Array.isArray(debugInfo)) {
        for (let i = debugInfo.length - 1; i >= 0; i--) {
          const entry = debugInfo[i];
          if (typeof entry.name === 'string') {
            info += describeDebugInfoFrame(
              entry.name,
              entry.env,
              entry.debugLocation
            );
          }
        }
      }

      previous = node;
      node = node.return;
    } while (node);
    return info;
  } catch (error) {
    if (error instanceof Error) {
      return `\nError generating stack: ${error.message}\n${error.stack}`;
    }
    return '';
  }
};

export const isCapitalized = (str: string): boolean => {
  if (!str.length) {
    return false;
  }
  return str[0] === str[0].toUpperCase();
};

export interface OwnerStackItem {
  name: string;
  source?: FiberSource;
}

export const getOwnerStack = async (
  stackTrace: string
): Promise<OwnerStackItem[]> => {
  // parse the stack trace to extract component names
  // formats:
  // - "\n    in ComponentName"
  // - "\n    in ComponentName (at Server)"
  // - "\n    at ComponentName (http://...)"
  const componentPattern =
    /\n\s+(?:in|at)\s+([^\s(]+)(?:\s+\((?:at\s+)?([^)]+)\))?/g;
  const matches: OwnerStackItem[] = [];

  let match: RegExpExecArray | null;
  match = componentPattern.exec(stackTrace);
  while (match !== null) {
    const name = match[1];
    const locationStr = match[2];

    if (!isCapitalized(name)) {
      match = componentPattern.exec(stackTrace);
      matches.push({
        name: name,
        source: undefined,
      });
      continue;
    }

    let source: FiberSource | undefined;

    if (locationStr && locationStr !== 'Server') {
      try {
        const mockFrame = `    at ${name} (${locationStr})`;
        const parsedSource = await parseStackFrame(mockFrame);
        if (parsedSource) {
          source = parsedSource;
        }
      } catch {}
    }

    matches.push({
      name: name,
      source: source || undefined,
    });

    match = componentPattern.exec(stackTrace);
  }

  return matches;
};
