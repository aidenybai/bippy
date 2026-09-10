import { cloneElement, useRef, type ReactElement, type Ref } from "react";

// React DnD's `cloneWithRef`: reads `element.ref` (the ref passed to the element, `null`
// when there is none), rejects string refs, and composes the connector's ref with it.

interface RefHolder {
  ref?: Ref<HTMLElement> | string;
}

const invariant = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const cloneWithRef = (
  element: ReactElement<RefHolder>,
  newRef: (node: HTMLElement | null) => void,
): ReactElement<RefHolder> => {
  const holder: RefHolder = element;
  const previousRef = holder.ref;
  invariant(typeof previousRef !== "string", "string refs are not supported");
  if (!previousRef) return cloneElement(element, { ref: newRef });
  return cloneElement(element, {
    ref: (node: HTMLElement | null) => {
      newRef(node);
      if (typeof previousRef === "function") previousRef(node);
    },
  });
};

const describeRef = (element: ReactElement<RefHolder>): string => {
  const holder: RefHolder = element;
  const ref = holder.ref;
  return ref === null ? "null" : ref === undefined ? "undefined" : typeof ref;
};

export default function ElementRefs() {
  const nodeRef = useRef<HTMLElement>(null);
  const connect = (element: ReactElement<RefHolder>) => cloneWithRef(element, () => {});
  const plain = <section>plain</section>;
  const withObjectRef = <section ref={nodeRef}>object</section>;
  const withCallbackRef = <section ref={() => {}}>callback</section>;
  return (
    <main>
      {connect(plain)}
      {connect(withObjectRef)}
      {connect(withCallbackRef)}
      <p>{describeRef(plain)}</p>
      <p>{describeRef(withObjectRef)}</p>
      <p>{describeRef(withCallbackRef)}</p>
    </main>
  );
}

export const isExact = true;
