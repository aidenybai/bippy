import type { Fiber } from "bippy";
import type * as React from "react";

interface FiberReferenceProviderProps {
  children?: React.ReactNode;
}

interface FiberReference {
  FiberProvider: React.ComponentType<FiberReferenceProviderProps>;
  useFiber: () => Fiber | undefined;
}

const getFiberByHookValue = (
  fiber: Fiber | null | undefined,
  hookValue: unknown,
): Fiber | undefined => {
  if (!fiber) return undefined;

  let currentHook = fiber.memoizedState;
  while (currentHook) {
    if (currentHook.memoizedState === hookValue) return fiber;
    currentHook = currentHook.next;
  }

  let childFiber = fiber.child;
  while (childFiber) {
    const matchedFiber = getFiberByHookValue(childFiber, hookValue);
    if (matchedFiber) return matchedFiber;
    childFiber = childFiber.sibling;
  }

  return undefined;
};

export const createFiberReference = (react: typeof React): FiberReference => {
  const FiberContext = react.createContext<Fiber | null>(null);

  class FiberProvider extends react.Component<FiberReferenceProviderProps> {
    declare _reactInternals: Fiber;

    override render() {
      return react.createElement(
        FiberContext.Provider,
        { value: this._reactInternals },
        this.props.children,
      );
    }
  }

  const useFiber = (): Fiber | undefined => {
    const providerFiber = react.useContext(FiberContext);
    if (providerFiber === null) {
      throw new Error("useFiber must be called within FiberProvider");
    }
    const [hookIdentifier] = react.useState<object>(() => ({}));

    return react.useMemo(() => {
      for (const rootFiber of [providerFiber, providerFiber?.alternate]) {
        const matchedFiber = getFiberByHookValue(rootFiber, hookIdentifier);
        if (matchedFiber) return matchedFiber;
      }
      return undefined;
    }, [hookIdentifier, providerFiber]);
  };

  return { FiberProvider, useFiber };
};
