import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  memo,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefCallback,
} from "react";

type AnyRef<Instance> = Ref<Instance> | undefined;

const setRef = <Instance,>(ref: AnyRef<Instance>, value: Instance): void | (() => void) => {
  if (typeof ref === "function") return ref(value);
  if (ref !== null && ref !== undefined) ref.current = value;
};

const composeRefs =
  <Instance,>(...refs: AnyRef<Instance>[]): RefCallback<Instance> =>
  (node) => {
    let hasCleanup = false;
    const cleanups = refs.map((ref) => {
      const cleanup = setRef(ref, node);
      if (!hasCleanup && typeof cleanup === "function") hasCleanup = true;
      return cleanup;
    });
    if (hasCleanup) {
      return () => {
        for (let index = 0; index < cleanups.length; index++) {
          const cleanup = cleanups[index];
          if (typeof cleanup === "function") cleanup();
          else setRef(refs[index], null);
        }
      };
    }
  };

const useComposedRefs = <Instance,>(...refs: AnyRef<Instance>[]): RefCallback<Instance> =>
  // biome-ignore lint/correctness/useExhaustiveDependencies: mirrors @radix-ui/react-compose-refs
  useCallback(composeRefs(...refs), refs);

const mergeRefs =
  (...refs: AnyRef<HTMLElement>[]): RefCallback<HTMLElement> =>
  (node) => {
    refs.forEach((ref) => {
      if (ref == null) return;
      if (typeof ref === "function") {
        ref(node);
        return;
      }
      if (typeof ref === "object") ref.current = node;
    });
  };

const useMergeRefs = (...refs: AnyRef<HTMLElement>[]): RefCallback<HTMLElement> =>
  // biome-ignore lint/correctness/useExhaustiveDependencies: mirrors react-native-web useMergeRefs
  useMemo(() => mergeRefs(...refs), [...refs]);

const getElementRef = (element: ReactElement<{ ref?: Ref<HTMLElement> }>): AnyRef<HTMLElement> => {
  const getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
  const mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) return undefined;
  return element.props.ref;
};

const SlotClone = forwardRef<HTMLElement, { children?: ReactNode; [key: string]: unknown }>(
  ({ children, ...slotProps }, forwardedRef) => {
    if (isValidElement<{ ref?: Ref<HTMLElement> }>(children)) {
      const childrenRef = getElementRef(children);
      const nextProps: Record<string, unknown> = { ...slotProps, ...children.props };
      nextProps.ref = forwardedRef ? composeRefs(forwardedRef, childrenRef) : childrenRef;
      return cloneElement(children, nextProps);
    }
    return Children.count(children) > 1 ? Children.only(null) : null;
  },
);

const HostView = forwardRef<HTMLElement, { children?: ReactNode }>(({ children }, forwardedRef) => {
  const [hostNode, setHostNode] = useState<HTMLElement | null>(null);
  const mergedRef = useMergeRefs(setHostNode, forwardedRef);
  return (
    <div ref={mergedRef} data-mounted={hostNode !== null}>
      {children}
    </div>
  );
});

const PressableView = memo(HostView);

const PassThrough = forwardRef<
  HTMLElement,
  { children: (props: { ref: Ref<HTMLElement> | null }) => ReactNode }
>((props, forwardedRef) => props.children({ ...props, ref: forwardedRef }));

const Trigger = forwardRef<
  HTMLButtonElement,
  { onTriggerChange: (node: HTMLButtonElement | null) => void; children: ReactNode }
>(({ onTriggerChange, children }, forwardedRef) => {
  const composedRefs = useComposedRefs(forwardedRef, onTriggerChange);
  return <SlotClone ref={composedRefs}>{children}</SlotClone>;
});

const Select = ({ form }: { form?: string }) => {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const isFormControl = trigger ? form || !!trigger.closest("form") : true;
  return (
    <span>
      <Trigger onTriggerChange={setTrigger}>
        <PassThrough>
          {(passed) => <PressableView ref={passed.ref}>open</PressableView>}
        </PassThrough>
      </Trigger>
      {isFormControl ? <input aria-hidden tabIndex={-1} readOnly value="" /> : null}
    </span>
  );
};

export const isExact = true;

export default function ComposedRefClosest() {
  return (
    <div>
      <Select />
      <form>
        <Select />
      </form>
      <Select form="external" />
    </div>
  );
}
