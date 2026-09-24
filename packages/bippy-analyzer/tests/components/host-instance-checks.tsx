import { useCallback, useEffect, useState } from "react";

const getWindow = (node: unknown): Window & typeof globalThis => {
  if (node && typeof node === "object" && "ownerDocument" in node) {
    const ownerDocument = node.ownerDocument;
    if (ownerDocument instanceof Document && ownerDocument.defaultView) {
      return ownerDocument.defaultView;
    }
  }
  return window;
};

const isNode = (value: unknown): value is Node =>
  value instanceof Node || value instanceof getWindow(value).Node;

const isElement = (value: unknown): value is Element =>
  value instanceof Element || value instanceof getWindow(value).Element;

const isHTMLElement = (value: unknown): value is HTMLElement =>
  value instanceof HTMLElement || value instanceof getWindow(value).HTMLElement;

const isShadowRoot = (value: unknown): value is ShadowRoot => {
  if (typeof ShadowRoot === "undefined") return false;
  return value instanceof ShadowRoot || value instanceof getWindow(value).ShadowRoot;
};

const useHoverOpen = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [reference, setReference] = useState<Element | null>(null);
  useEffect(() => {
    if (!isElement(reference)) return undefined;
    const open = () => setIsOpen(true);
    const close = () => setIsOpen(false);
    reference.addEventListener("mouseenter", open);
    reference.addEventListener("mouseleave", close);
    return () => {
      reference.removeEventListener("mouseenter", open);
      reference.removeEventListener("mouseleave", close);
    };
  }, [reference]);
  const setRef = useCallback((node: Element | null) => setReference(node), []);
  return { isOpen, setRef, reference };
};

const Trigger = () => {
  const { isOpen, setRef, reference } = useHoverOpen();
  return (
    <span ref={setRef}>
      {isOpen ? <output>tip</output> : <i />}
      {String(isElement(reference))}
    </span>
  );
};

const Verdicts = () => (
  <ul>
    <li>{String([isNode(null), isElement(undefined), isHTMLElement(null)])}</li>
    <li>{String([isNode(0), isElement("div"), isHTMLElement(false)])}</li>
    <li>{String([isShadowRoot(null), isShadowRoot({}), isElement({ nodeType: 1 })])}</li>
  </ul>
);

export default function HostInstanceChecks() {
  return (
    <section>
      <Trigger />
      <Verdicts />
    </section>
  );
}

export const isExact = true;
