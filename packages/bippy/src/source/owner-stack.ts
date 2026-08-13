import { getDisplayName, getType, traverseFiber } from "../core.js";
import { getReactWorkTagsForFiber } from "../react-internals/index.js";
import type {
  Fiber,
  RendererDispatcherRef,
  ServerComponentInfo,
} from "../react-internals/index.js";
import {
  REACT_STACK_BOTTOM_FRAME_PATTERNS,
  SERVER_FRAME_MARKER,
  SERVER_ENV_PATTERN,
  SERVER_COMPONENT_URL_PREFIXES,
} from "./constants.js";
import { getPrepareStackTrace, setPrepareStackTrace } from "./error-stack.js";
import { parseDebugStack } from "./parse-debug-stack.js";
import { isUsableFileName, parseStack, StackFrame } from "./parse-stack.js";
import {
  getRendererDispatcherRefs,
  readDispatcher,
  writeDispatcher,
} from "./renderer-dispatchers.js";
import { symbolicateStack, type SourceFetch } from "./symbolication.js";

interface RendererDispatcherSnapshot {
  currentDispatcherRef: RendererDispatcherRef;
  value: unknown;
}

export const hasDebugStack = (
  fiber: Fiber,
): fiber is Fiber & {
  _debugStack: NonNullable<Fiber["_debugStack"]>;
} => {
  return fiber._debugStack instanceof Error && typeof fiber._debugStack?.stack === "string";
};

const isFiberOwner = (owner: Fiber | ServerComponentInfo): owner is Fiber =>
  "tag" in owner && typeof owner.tag === "number";

/**
 * Locates a frame inside the fiber's own function body without invoking it:
 * any child fiber owned by this fiber was created by JSX inside its body, so
 * the bottom user-space frame of that child's _debugStack sits in this
 * component. The enclosing line/column (V8 CallSite API) points at the
 * function definition start. Requires React 19 (_debugStack).
 */
export const getDefinitionFrameFromOwnedChild = (fiber: Fiber): StackFrame | null => {
  let ownedChildDebugStack: Error | null = null;
  traverseFiber(fiber, (childFiber) => {
    if (childFiber === fiber) {
      return false;
    }
    const childOwner = childFiber._debugOwner;
    if (
      (childOwner === fiber || (fiber.alternate !== null && childOwner === fiber.alternate)) &&
      childFiber._debugStack instanceof Error
    ) {
      ownedChildDebugStack = childFiber._debugStack;
      return true;
    }
    return false;
  });
  if (!ownedChildDebugStack) {
    return null;
  }

  const { frames, isTrusted } = parseDebugStack(ownedChildDebugStack);
  if (!isTrusted) {
    return null;
  }
  for (let frameIndex = frames.length - 1; frameIndex >= 0; frameIndex--) {
    const stackFrame = frames[frameIndex];
    if (!isUsableFileName(stackFrame.fileName)) {
      continue;
    }
    return {
      ...stackFrame,
      lineNumber: stackFrame.enclosingLineNumber || stackFrame.lineNumber,
      columnNumber: stackFrame.enclosingColumnNumber || stackFrame.columnNumber,
    };
  }
  return null;
};

const clearRendererDispatchers = (): RendererDispatcherSnapshot[] => {
  const dispatcherSnapshots: RendererDispatcherSnapshot[] = [];
  for (const currentDispatcherRef of getRendererDispatcherRefs()) {
    dispatcherSnapshots.push({ currentDispatcherRef, value: readDispatcher(currentDispatcherRef) });
    writeDispatcher(currentDispatcherRef, null);
  }
  return dispatcherSnapshots;
};

const restoreRendererDispatchers = (dispatcherSnapshots: RendererDispatcherSnapshot[]): void => {
  for (const { currentDispatcherRef, value } of dispatcherSnapshots) {
    writeDispatcher(currentDispatcherRef, value);
  }
};

const describeBuiltInComponentFrame = (name: string): string => {
  return `\n    in ${name}`;
};

export const describeDebugInfoFrame = (name: string, env?: string): string => {
  let frameDescription = describeBuiltInComponentFrame(name);
  if (env) {
    frameDescription += ` (at ${env})`;
  }
  return frameDescription;
};

let reEntry = false;

// Computing a frame throws and parses two full error stacks, so cache per
// component type like React DevTools does.
const componentFrameCache = new WeakMap<React.ComponentType<unknown>, string>();

// https://github.com/facebook/react/blob/f739642745577a8e4dcb9753836ac3589b9c590a/packages/react-devtools-shared/src/backend/shared/DevToolsComponentStackFrame.js#L22
const describeNativeComponentFrame = (
  component: React.ComponentType<unknown>,
  construct: boolean,
): string => {
  if (!component || reEntry) {
    return "";
  }

  const cachedFrame = componentFrameCache.get(component);
  if (cachedFrame !== undefined) {
    return cachedFrame;
  }

  const previousPrepareStackTrace = getPrepareStackTrace();
  setPrepareStackTrace(undefined);
  reEntry = true;

  const dispatcherSnapshots = clearRendererDispatchers();
  const previousConsoleError = console.error;
  const previousConsoleWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    // HACK: Run the control and sample under the same property name so their stacks share a frame.
    const RunInRootFrame = {
      DetermineComponentFrameRoot(this: void) {
        let control: unknown;
        try {
          if (construct) {
            const ThrowingConstructor = function () {
              throw Error();
            };
            Object.defineProperty(ThrowingConstructor.prototype, "props", {
              set: function () {
                throw Error();
              },
            });
            if (typeof Reflect === "object" && Reflect.construct) {
              try {
                Reflect.construct(ThrowingConstructor, []);
              } catch (caughtError) {
                control = caughtError;
              }
              Reflect.construct(component, [], ThrowingConstructor);
            } else {
              try {
                Function.prototype.apply.call(ThrowingConstructor, undefined, []);
              } catch (caughtError) {
                control = caughtError;
              }
              Function.prototype.apply.call(component, ThrowingConstructor.prototype, []);
            }
          } else {
            try {
              throw Error();
            } catch (caughtError) {
              control = caughtError;
            }
            const maybePromise = Function.prototype.apply.call(component, undefined, []);
            if (
              typeof maybePromise === "object" &&
              maybePromise !== null &&
              "catch" in maybePromise &&
              typeof maybePromise.catch === "function"
            ) {
              maybePromise.catch(() => undefined);
            }
          }
        } catch (sample: unknown) {
          if (
            sample instanceof Error &&
            control instanceof Error &&
            typeof sample.stack === "string"
          ) {
            return [sample.stack, control.stack];
          }
        }
        return [null, null];
      },
    };

    Object.defineProperty(RunInRootFrame.DetermineComponentFrameRoot, "displayName", {
      value: "DetermineComponentFrameRoot",
    });
    const namePropDescriptor = Object.getOwnPropertyDescriptor(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      RunInRootFrame.DetermineComponentFrameRoot,
      "name",
    );
    if (namePropDescriptor?.configurable) {
      Object.defineProperty(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        RunInRootFrame.DetermineComponentFrameRoot,
        "name",
        { value: "DetermineComponentFrameRoot" },
      );
    }

    const [sampleStack, controlStack] = RunInRootFrame.DetermineComponentFrameRoot();
    if (sampleStack && controlStack) {
      // This extracts the first frame from the sample that isn't also in the control.
      // Skipping one frame that we assume is the frame that calls the two.
      const sampleLines = sampleStack.split("\n");
      const controlLines = controlStack.split("\n");
      let sampleIndex = 0;
      let controlIndex = 0;
      while (
        sampleIndex < sampleLines.length &&
        !sampleLines[sampleIndex].includes("DetermineComponentFrameRoot")
      ) {
        sampleIndex++;
      }
      while (
        controlIndex < controlLines.length &&
        !controlLines[controlIndex].includes("DetermineComponentFrameRoot")
      ) {
        controlIndex++;
      }
      // We couldn't find our intentionally injected common root frame, attempt
      // to find another common root frame by search from the bottom of the
      // control stack...
      if (sampleIndex === sampleLines.length || controlIndex === controlLines.length) {
        sampleIndex = sampleLines.length - 1;
        controlIndex = controlLines.length - 1;
        while (
          sampleIndex >= 1 &&
          controlIndex >= 0 &&
          sampleLines[sampleIndex] !== controlLines[controlIndex]
        ) {
          // We expect at least one stack frame to be shared.
          // Typically this will be the root most one. However, stack frames may be
          // cut off due to maximum stack limits. In this case, one maybe cut off
          // earlier than the other. We assume that the sample is longer or the same
          // and there for cut off earlier. So we should find the root most frame in
          // the sample somewhere in the control.
          controlIndex--;
        }
      }
      for (; sampleIndex >= 1 && controlIndex >= 0; sampleIndex--, controlIndex--) {
        // Next we find the first one that isn't the same which should be the
        // frame that called our sample function and the control.
        if (sampleLines[sampleIndex] !== controlLines[controlIndex]) {
          // In V8, the first line is describing the message but other VMs don't.
          // If we're about to return the first line, and the control is also on the same
          // line, that's a pretty good indicator that our sample threw at same line as
          // the control. I.e. before we entered the sample frame. So we ignore this result.
          // This can happen if you passed a class to function component, or non-function.
          if (sampleIndex !== 1 || controlIndex !== 1) {
            do {
              sampleIndex--;
              controlIndex--;
              // We may still have similar intermediate frames from the construct call.
              // The next one that isn't the same should be our match though.
              if (controlIndex < 0 || sampleLines[sampleIndex] !== controlLines[controlIndex]) {
                // V8 adds a "new" prefix for native classes. Let's remove it to make it prettier.
                let stackFrame = `\n${sampleLines[sampleIndex].replace(" at new ", " at ")}`;

                const displayName = getDisplayName(component);
                // If our component frame is labeled "<anonymous>"
                // but we have a user-provided "displayName"
                // splice it in to make the stack more readable.
                if (displayName && stackFrame.includes("<anonymous>")) {
                  stackFrame = stackFrame.replace("<anonymous>", displayName);
                }
                // Return the line we found.
                componentFrameCache.set(component, stackFrame);
                return stackFrame;
              }
            } while (sampleIndex >= 1 && controlIndex >= 0);
          }
          break;
        }
      }
    }
  } finally {
    reEntry = false;

    setPrepareStackTrace(previousPrepareStackTrace);

    restoreRendererDispatchers(dispatcherSnapshots);
    console.error = previousConsoleError;
    console.warn = previousConsoleWarn;
  }

  const componentName = getDisplayName(component);
  const syntheticFrame = componentName ? describeBuiltInComponentFrame(componentName) : "";
  componentFrameCache.set(component, syntheticFrame);
  return syntheticFrame;
};

// https://github.com/facebook/react/blob/ac3e705a18696168acfcaed39dce0cfaa6be8836/packages/react-reconciler/src/ReactFiberComponentStack.js#L180
export const describeFiber = (fiber: Fiber, childFiber: Fiber | null): string => {
  let stackFrame = "";
  const workTags = getReactWorkTagsForFiber(fiber);
  switch (fiber.tag) {
    case workTags.ActivityComponent:
      stackFrame = describeBuiltInComponentFrame("Activity");
      break;
    case workTags.ClassComponent:
      stackFrame = describeNativeComponentFrame(fiber.type, true);
      break;
    case workTags.ForwardRef:
      stackFrame = describeNativeComponentFrame(getType(fiber.type) ?? fiber.type, false);
      break;
    case workTags.FunctionComponent:
    case workTags.SimpleMemoComponent:
      stackFrame = describeNativeComponentFrame(getType(fiber.type) ?? fiber.type, false);
      break;
    case workTags.HostComponent:
    case workTags.HostHoistable:
    case workTags.HostSingleton:
      if (typeof fiber.type === "string") {
        stackFrame = describeBuiltInComponentFrame(fiber.type);
      }
      break;
    case workTags.LazyComponent:
      // TODO: When we support Thenables as component types we should rename this.
      stackFrame = describeBuiltInComponentFrame("Lazy");
      break;
    case workTags.SuspenseComponent:
      if (fiber.child !== childFiber && childFiber !== null) {
        // If we came from the second Fiber then we're in the Suspense Fallback.
        stackFrame = describeBuiltInComponentFrame("Suspense Fallback");
      } else {
        stackFrame = describeBuiltInComponentFrame("Suspense");
      }
      break;
    case workTags.SuspenseListComponent:
      stackFrame = describeBuiltInComponentFrame("SuspenseList");
      break;
    case workTags.ViewTransitionComponent:
      // Note: enableViewTransition feature flag is not available in this codebase,
      // so we'll always include ViewTransition
      stackFrame = describeBuiltInComponentFrame("ViewTransition");
      break;
    default:
      return "";
  }

  return stackFrame;
};

/**
 * Builds a component-stack string by walking the fiber `return` chain, the
 * pre-react-19 substitute for `_debugStack` (which is why the frame locations
 * come from re-invocation in {@link describeFiber} rather than a real stack).
 */
export const getFallbackParentStack = (thisFiber: Fiber): string => {
  try {
    let componentStack = "";
    let currentFiber: Fiber | null = thisFiber;
    let previousFiber: Fiber | null = null;
    do {
      componentStack += describeFiber(currentFiber, previousFiber);

      // Add any Server Component stack frames in reverse order (dev only).
      // Since we don't have __DEV__ in this codebase, we'll check for _debugInfo
      const debugInfo = currentFiber._debugInfo;
      if (debugInfo && Array.isArray(debugInfo)) {
        for (let debugInfoIndex = debugInfo.length - 1; debugInfoIndex >= 0; debugInfoIndex--) {
          const debugEntry = debugInfo[debugInfoIndex];
          if (typeof debugEntry.name === "string") {
            componentStack += describeDebugInfoFrame(debugEntry.name, debugEntry.env);
          }
        }
      }

      previousFiber = currentFiber;
      currentFiber = currentFiber.return;
    } while (currentFiber);
    return componentStack;
  } catch (error) {
    if (error instanceof Error) {
      return `\nBippy couldn’t generate the stack: ${error.message}\n${error.stack}`;
    }
    return "";
  }
};

/**
 * takes Error.stack and formats it to only the React owner stack
 *
 * before:
 * ```
 * Error: react-stack-top-frame
 * at fakeJSXCallSite (http://localhost:3000/_next/static/chunks/<chunk-name>._.js:17665:16)
 * at TodoItem (rsc://React/Server/file:///path/to/project/.next/server/chunks/ssr/<chunk-name>._.js)
 * at react-stack-bottom-frame (http://localhost:3000/_next/static/chunks/<chunk-name>._.js:17984:89)
 * ```
 *
 * after:
 * ```
 * at TodoItem (rsc://React/Server/file:///path/to/project/.next/server/chunks/ssr/<chunk-name>._.js)
 * ```
 *
 * @see https://github.com/facebook/react/blob/main/packages/react-devtools-shared/src/backend/shared/DevToolsOwnerStack.js#L12
 */
export const formatOwnerStack = (stack: string): string => {
  let formattedStack = stack;
  if (!formattedStack) {
    return "";
  }

  if (formattedStack.startsWith("Error: react-stack-top-frame\n")) {
    // V8's default formatting prefixes with the error message which we
    // don't want/need
    formattedStack = formattedStack.slice(29);
  }
  const firstNewlineIndex = formattedStack.indexOf("\n");
  if (firstNewlineIndex !== -1) {
    // pop the JSX frame
    formattedStack = formattedStack.slice(firstNewlineIndex + 1);
  }
  let bottomFrameIndex = Math.max(
    ...REACT_STACK_BOTTOM_FRAME_PATTERNS.map((pattern) => formattedStack.indexOf(pattern)),
  );
  if (bottomFrameIndex !== -1) {
    bottomFrameIndex = formattedStack.lastIndexOf("\n", bottomFrameIndex);
  }
  if (bottomFrameIndex !== -1) {
    // cut off everything after the bottom frame since it'll be internals.
    formattedStack = formattedStack.slice(0, bottomFrameIndex);
  } else {
    // we didn't find any internal callsite out to user space.
    // This means that this was called outside an owner or the owner is fully internal.
    // to keep things light we exclude the entire trace in this case.
    return "";
  }
  return formattedStack;
};

const isReactServerComponentFrame = (stackFrame: StackFrame): boolean =>
  Boolean(
    stackFrame.functionName && stackFrame.fileName && isServerComponentUrl(stackFrame.fileName),
  );

const areStackFramesEqual = (firstFrame: StackFrame, secondFrame: StackFrame): boolean =>
  firstFrame.fileName === secondFrame.fileName &&
  firstFrame.lineNumber === secondFrame.lineNumber &&
  firstFrame.columnNumber === secondFrame.columnNumber;

const buildFunctionNameToRscFramesMap = (
  debugStackFrames: StackFrame[],
): Map<string, StackFrame[]> => {
  const functionNameToRscFrames = new Map<string, StackFrame[]>();

  for (const stackFrame of debugStackFrames) {
    if (!isReactServerComponentFrame(stackFrame)) continue;

    const functionName = stackFrame.functionName!;
    const framesForFunction = functionNameToRscFrames.get(functionName) ?? [];
    const isDuplicateFrame = framesForFunction.some((existingFrame) =>
      areStackFramesEqual(existingFrame, stackFrame),
    );

    if (!isDuplicateFrame) {
      framesForFunction.push(stackFrame);
      functionNameToRscFrames.set(functionName, framesForFunction);
    }
  }

  return functionNameToRscFrames;
};

const getEnrichedServerStackFrame = (
  serverFrame: StackFrame,
  functionNameToRscFrames: Map<string, StackFrame[]>,
  functionNameToUsageIndex: Map<string, number>,
): StackFrame => {
  if (!serverFrame.functionName) {
    return { ...serverFrame, isServer: true };
  }

  const availableRscFrames = functionNameToRscFrames.get(serverFrame.functionName);
  if (!availableRscFrames || availableRscFrames.length === 0) {
    return { ...serverFrame, isServer: true };
  }

  const currentUsageIndex = functionNameToUsageIndex.get(serverFrame.functionName) ?? 0;
  const resolvedRscFrame = availableRscFrames[currentUsageIndex % availableRscFrames.length];
  functionNameToUsageIndex.set(serverFrame.functionName, currentUsageIndex + 1);

  return {
    ...serverFrame,
    isServer: true,
    fileName: resolvedRscFrame.fileName,
    lineNumber: resolvedRscFrame.lineNumber,
    columnNumber: resolvedRscFrame.columnNumber,
    source: serverFrame.source?.replace(
      SERVER_FRAME_MARKER,
      `(${resolvedRscFrame.fileName}:${resolvedRscFrame.lineNumber}:${resolvedRscFrame.columnNumber})`,
    ),
  };
};

const isServerComponentUrl = (url: string): boolean =>
  SERVER_COMPONENT_URL_PREFIXES.some((prefix) => url.startsWith(prefix));

// flight installs fake server frames (rsc:// or about://React/ urls) into
// client-side debug stacks, so server detection must be per-frame
const markFlightServerFrame = (stackFrame: StackFrame): StackFrame =>
  !stackFrame.isServer && stackFrame.fileName && isServerComponentUrl(stackFrame.fileName)
    ? { ...stackFrame, isServer: true }
    : stackFrame;

/**
 * Builds owner-chain stack frames from the _debugStack errors React 19
 * attaches at JSX creation, walking `_debugOwner` across both client fibers
 * and server components (ReactComponentInfo, which chains via `.owner` and
 * carries `.debugStack`). This is exact - no re-invoking components, no
 * name-matching heuristics - but requires React 19.
 */
const getOwnerStackFromDebugStacks = (fiber: Fiber): StackFrame[] => {
  const ownerStackFrames: StackFrame[] = [];
  let owner: Fiber | ServerComponentInfo | null | undefined = fiber;
  while (owner) {
    if (isFiberOwner(owner)) {
      const ownerFiber: Fiber = owner;
      owner = ownerFiber._debugOwner;
      if (owner && hasDebugStack(ownerFiber)) {
        const { frames, isTrusted } = parseDebugStack(ownerFiber._debugStack);
        if (isTrusted) {
          for (const stackFrame of frames) {
            ownerStackFrames.push(markFlightServerFrame(stackFrame));
          }
        }
      }
    } else {
      const serverOwner: ServerComponentInfo = owner;
      owner = serverOwner.owner;
      // server stacks are captured and pre-trimmed by flight, so they carry
      // no bottom-frame sentinel and are trusted as-is
      if (owner && serverOwner.debugStack instanceof Error) {
        for (const serverFrame of parseDebugStack(serverOwner.debugStack).frames) {
          ownerStackFrames.push({ ...serverFrame, isServer: true });
        }
      }
    }
  }
  return ownerStackFrames;
};

const getDebugStackFrames = (rootFiber: Fiber): StackFrame[] => {
  const debugStackFrames: StackFrame[] = [];

  traverseFiber(
    rootFiber,
    (currentFiber) => {
      if (!hasDebugStack(currentFiber)) return;

      const { frames, isTrusted } = parseDebugStack(currentFiber._debugStack);
      if (isTrusted) {
        debugStackFrames.push(...frames);
      }
    },
    true,
  );

  return debugStackFrames;
};

/**
 * The unsymbolicated frames behind {@link getParentStack}: bundle-space
 * locations from re-invoking each component with a throwing dispatcher,
 * with server frames enriched from debug stacks by name matching.
 */
export const getRawParentStack = (fiber: Fiber): StackFrame[] => {
  const debugStackFrames = getDebugStackFrames(fiber);
  const fallbackStackFrames = parseStack(getFallbackParentStack(fiber));
  const functionNameToRscFrames = buildFunctionNameToRscFramesMap(debugStackFrames);
  const functionNameToUsageIndex = new Map<string, number>();

  const enrichedStackFrames = fallbackStackFrames.map((stackFrame): StackFrame => {
    const isServerFrame =
      stackFrame.source !== undefined && SERVER_ENV_PATTERN.test(stackFrame.source);

    if (isServerFrame) {
      return getEnrichedServerStackFrame(
        stackFrame,
        functionNameToRscFrames,
        functionNameToUsageIndex,
      );
    }

    return stackFrame;
  });

  return enrichedStackFrames.filter((stackFrame, index, frames) => {
    if (index === 0) return true;
    const previousFrame = frames[index - 1];
    return stackFrame.functionName !== previousFrame.functionName;
  });
};

/**
 * Returns a stack of ALL ancestor components in the render tree (the fiber's
 * `return` chain), including wrappers that render `{children}` without having
 * created this fiber's JSX. Locations come from re-invoking each component
 * with a throwing dispatcher; server frames are enriched from debug stacks by
 * name matching. Works on every React version.
 */
export const getParentStack = async (
  fiber: Fiber,
  shouldCache = true,
  fetchFunction?: SourceFetch,
): Promise<StackFrame[]> => symbolicateStack(getRawParentStack(fiber), shouldCache, fetchFunction);

// an owner frame is only actionable if it can point an editor somewhere:
// it needs a file location and must not be ignore-listed bundler/framework code
const isLocatableFrame = (stackFrame: StackFrame): boolean =>
  Boolean(stackFrame.fileName) && !stackFrame.isIgnoreListed;

/**
 * Returns the stack of components that CREATED this fiber's JSX (the
 * `_debugOwner` chain), with exact creation-site locations from React 19's
 * `_debugStack` errors - including server component owners. Wrappers that
 * merely render `{children}` do not appear; use {@link getParentStack} for
 * the full render-tree ancestry. Falls back to {@link getParentStack} on
 * React <19, when no trusted debug stacks exist, or when the owner chain
 * yields no locatable frames (so callers always get the most useful stack
 * available).
 */
export const getOwnerStack = async (
  fiber: Fiber,
  shouldCache = true,
  fetchFunction?: SourceFetch,
): Promise<StackFrame[]> => {
  const debugStackFrames = getOwnerStackFromDebugStacks(fiber);
  if (debugStackFrames.length > 0) {
    // the owner chain does not include the fiber itself, but bippy's stacks
    // always start with the fiber's own frame
    const selfFrame: StackFrame = getDefinitionFrameFromOwnedChild(fiber) ?? {};
    selfFrame.functionName = getDisplayName(fiber.type) ?? selfFrame.functionName;
    const symbolicatedFrames = await symbolicateStack(
      [selfFrame, ...debugStackFrames],
      shouldCache,
      fetchFunction,
    );
    const hasLocatableOwnerFrame = symbolicatedFrames.some(
      (stackFrame, frameIndex) => frameIndex > 0 && isLocatableFrame(stackFrame),
    );
    if (hasLocatableOwnerFrame) {
      return symbolicatedFrames;
    }
  }

  return getParentStack(fiber, shouldCache, fetchFunction);
};
