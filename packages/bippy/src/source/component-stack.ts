import {
  _renderers,
  ActivityComponentTag,
  ClassComponentTag,
  Fiber,
  ForwardRefTag,
  FunctionComponentTag,
  getDisplayName,
  getRDTHook,
  HostComponentTag,
  HostHoistableTag,
  HostSingletonTag,
  LazyComponentTag,
  SimpleMemoComponentTag,
  SuspenseComponentTag,
  SuspenseListComponentTag,
  ViewTransitionComponentTag,
} from '../index.js';

const getCurrentDispatcher = (): null | React.RefObject<unknown> => {
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

const setCurrentDispatcher = (value: null | React.RefObject<unknown>): void => {
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

// https://github.com/facebook/react/blob/f739642745577a8e4dcb9753836ac3589b9c590a/packages/react-devtools-shared/src/backend/shared/DevToolsComponentStackFrame.js#L22
const describeNativeComponentFrame = (
  component: React.ComponentType<unknown>,
  construct: boolean,
): string => {
  if (!component || reEntry) {
    return '';
  }

  const previousPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = undefined;
  reEntry = true;

  const previousDispatcher = getCurrentDispatcher();
  setCurrentDispatcher(null);
  const previousConsoleError = console.error;
  const previousConsoleWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
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
        let control: unknown;
        try {
          // This should throw.
          if (construct) {
            // Something should be setting the props in the constructor.
            const ThrowingConstructor = function () {
              throw Error();
            };
            Object.defineProperty(ThrowingConstructor.prototype, 'props', {
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
                Reflect.construct(ThrowingConstructor, []);
              } catch (caughtError) {
                control = caughtError;
              }
              Reflect.construct(component, [], ThrowingConstructor);
            } else {
              try {
                // @ts-expect-error -- ThrowingConstructor is a constructor function
                ThrowingConstructor.call();
              } catch (caughtError) {
                control = caughtError;
              }
              // @ts-expect-error -- ThrowingConstructor is a constructor function
              component.call(ThrowingConstructor.prototype);
            }
          } else {
            try {
              throw Error();
            } catch (caughtError) {
              control = caughtError;
            }
            // TODO(luna): This will currently only throw if the function component
            // tries to access React/ReactDOM/props. We should probably make this throw
            // in simple components too
            const maybePromise = (component as () => Promise<unknown>)();

            // If the function component returns a promise, it's likely an async
            // component, which we don't yet support. Attach a noop catch handler to
            // silence the error.
            // TODO: Implement component stacks for async client components?
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- we literally check if this is a promise here
            if (maybePromise && typeof maybePromise.catch === 'function') {
              maybePromise.catch(() => {});
            }
          }
        } catch (sample: unknown) {
          // This is inlined manually because closure doesn't do it for us.
          if (
            sample instanceof Error &&
            control instanceof Error &&
            typeof sample.stack === 'string'
          ) {
            return [sample.stack, control.stack];
          }
        }
        return [null, null];
      },
    };

    // @ts-expect-error --- displayName is not a property of the function
    RunInRootFrame.DetermineComponentFrameRoot.displayName =
      'DetermineComponentFrameRoot';
    const namePropDescriptor = Object.getOwnPropertyDescriptor(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      RunInRootFrame.DetermineComponentFrameRoot,
      'name',
    );
    // Before ES6, the `name` property was not configurable.
    if (namePropDescriptor?.configurable) {
      // V8 utilizes a function's `name` property when generating a stack trace.
      Object.defineProperty(
        // eslint-disable-next-line @typescript-eslint/unbound-method
        RunInRootFrame.DetermineComponentFrameRoot,
        // Configurable properties can be updated even if its writable descriptor
        // is set to `false`.
        // $FlowFixMe[cannot-write]
        'name',
        { value: 'DetermineComponentFrameRoot' },
      );
    }

    const [sampleStack, controlStack] =
      RunInRootFrame.DetermineComponentFrameRoot();
    if (sampleStack && controlStack) {
      // This extracts the first frame from the sample that isn't also in the control.
      // Skipping one frame that we assume is the frame that calls the two.
      const sampleLines = sampleStack.split('\n');
      const controlLines = controlStack.split('\n');
      let sampleIndex = 0;
      let controlIndex = 0;
      while (
        sampleIndex < sampleLines.length &&
        !sampleLines[sampleIndex].includes('DetermineComponentFrameRoot')
      ) {
        sampleIndex++;
      }
      while (
        controlIndex < controlLines.length &&
        !controlLines[controlIndex].includes('DetermineComponentFrameRoot')
      ) {
        controlIndex++;
      }
      // We couldn't find our intentionally injected common root frame, attempt
      // to find another common root frame by search from the bottom of the
      // control stack...
      if (
        sampleIndex === sampleLines.length ||
        controlIndex === controlLines.length
      ) {
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
      for (
        ;
        sampleIndex >= 1 && controlIndex >= 0;
        sampleIndex--, controlIndex--
      ) {
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
              if (
                controlIndex < 0 ||
                sampleLines[sampleIndex] !== controlLines[controlIndex]
              ) {
                // V8 adds a "new" prefix for native classes. Let's remove it to make it prettier.
                let stackFrame = `\n${sampleLines[sampleIndex].replace(
                  ' at new ',
                  ' at ',
                )}`;

                const displayName = getDisplayName(component);
                // If our component frame is labeled "<anonymous>"
                // but we have a user-provided "displayName"
                // splice it in to make the stack more readable.
                if (displayName && stackFrame.includes('<anonymous>')) {
                  stackFrame = stackFrame.replace('<anonymous>', displayName);
                }
                // Return the line we found.
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

    Error.prepareStackTrace = previousPrepareStackTrace;

    setCurrentDispatcher(previousDispatcher);
    console.error = previousConsoleError;
    console.warn = previousConsoleWarn;
  }

  const componentName = component ? getDisplayName(component) : '';
  const syntheticFrame = componentName
    ? describeBuiltInComponentFrame(componentName)
    : '';
  return syntheticFrame;
};

// https://github.com/facebook/react/blob/ac3e705a18696168acfcaed39dce0cfaa6be8836/packages/react-reconciler/src/ReactFiberComponentStack.js#L180
export const describeFiber = (
  fiber: Fiber,
  childFiber: Fiber | null,
): string => {
  const tag = fiber.tag as number;
  let stackFrame = '';
  switch (tag) {
    case ActivityComponentTag:
      stackFrame = describeBuiltInComponentFrame('Activity');
      break;
    case ClassComponentTag:
      stackFrame = describeNativeComponentFrame(fiber.type, true);
      break;
    case ForwardRefTag:
      stackFrame = describeNativeComponentFrame(
        (fiber.type as { render: React.ComponentType<unknown> }).render,
        false,
      );
      break;
    case FunctionComponentTag:
    case SimpleMemoComponentTag:
      stackFrame = describeNativeComponentFrame(fiber.type, false);
      break;
    case HostComponentTag:
    case HostHoistableTag:
    case HostSingletonTag:
      stackFrame = describeBuiltInComponentFrame(fiber.type as string);
      break;
    case LazyComponentTag:
      // TODO: When we support Thenables as component types we should rename this.
      stackFrame = describeBuiltInComponentFrame('Lazy');
      break;
    case SuspenseComponentTag:
      if (fiber.child !== childFiber && childFiber !== null) {
        // If we came from the second Fiber then we're in the Suspense Fallback.
        stackFrame = describeBuiltInComponentFrame('Suspense Fallback');
      } else {
        stackFrame = describeBuiltInComponentFrame('Suspense');
      }
      break;
    case SuspenseListComponentTag:
      stackFrame = describeBuiltInComponentFrame('SuspenseList');
      break;
    case ViewTransitionComponentTag:
      // Note: enableViewTransition feature flag is not available in this codebase,
      // so we'll always include ViewTransition
      stackFrame = describeBuiltInComponentFrame('ViewTransition');
      break;
    default:
      return '';
  }

  return stackFrame;
};

/**
 * react 19 introduces the _debugStack property, which we can use to grab the stack.
 * however, for versions that don't have this property, we need to construct
 * a "fake" version of the owner stack
 */
export const getFallbackOwnerStack = (thisFiber: Fiber): string => {
  try {
    let componentStack = '';
    let currentFiber: Fiber | null = thisFiber;
    let previousFiber: Fiber | null = null;
    do {
      componentStack += describeFiber(currentFiber, previousFiber);

      // Add any Server Component stack frames in reverse order (dev only).
      // Since we don't have __DEV__ in this codebase, we'll check for _debugInfo
      const debugInfo = currentFiber._debugInfo;
      if (debugInfo && Array.isArray(debugInfo)) {
        for (let i = debugInfo.length - 1; i >= 0; i--) {
          const debugEntry = debugInfo[i];
          if (typeof debugEntry.name === 'string') {
            componentStack += describeDebugInfoFrame(
              debugEntry.name,
              debugEntry.env,
            );
          }
        }
      }

      previousFiber = currentFiber;
      currentFiber = currentFiber.return;
    } while (currentFiber);
    return componentStack;
  } catch (error) {
    if (error instanceof Error) {
      return `\nError generating stack: ${error.message}\n${error.stack}`;
    }
    return '';
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
  const prevPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = undefined;
  let formattedStack = stack;
  if (!formattedStack) {
    return '';
  }
  Error.prepareStackTrace = prevPrepareStackTrace;

  if (formattedStack.startsWith('Error: react-stack-top-frame\n')) {
    // V8's default formatting prefixes with the error message which we
    // don't want/need
    formattedStack = formattedStack.slice(29);
  }
  let idx = formattedStack.indexOf('\n');
  if (idx !== -1) {
    // pop the JSX frame
    formattedStack = formattedStack.slice(idx + 1);
  }
  idx = Math.max(
    formattedStack.indexOf('react_stack_bottom_frame'),
    formattedStack.indexOf('react-stack-bottom-frame'),
  );
  if (idx !== -1) {
    idx = formattedStack.lastIndexOf('\n', idx);
  }
  if (idx !== -1) {
    // cut off everything after the bottom frame since it'll be internals.
    formattedStack = formattedStack.slice(0, idx);
  } else {
    // we didn't find any internal callsite out to user space.
    // This means that this was called outside an owner or the owner is fully internal.
    // to keep things light we exclude the entire trace in this case.
    return '';
  }
  return formattedStack;
};
