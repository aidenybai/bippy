import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const AddToHomescreen = () => {
  if (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches) {
    return null;
  }
  return <aside>install banner</aside>;
};

const Responsive = () => {
  const [isWide] = useState(() => window.matchMedia("(min-width: 640px)").matches);
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const reducesMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <nav data-wide={isWide}>
      {isWide ? <ul>wide</ul> : <ol>narrow</ol>}
      {isDark ? <b>dark</b> : <i>light</i>}
      {reducesMotion ? <s>still</s> : <u>animated</u>}
    </nav>
  );
};

const CallbackRefPortal = ({ children }: { children: React.ReactNode }) => {
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const handleRef = useCallback((node: HTMLDivElement | null) => {
    setPortalNode(node);
  }, []);
  return (
    <>
      <div ref={handleRef} data-portal-root />
      {portalNode && createPortal(children, portalNode)}
    </>
  );
};

const LayoutEffectContainer = () => {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [isBody, setIsBody] = useState(false);
  useLayoutEffect(() => {
    const target = document.body;
    setContainer(target);
    setIsBody(target === document.body);
  }, []);
  if (!container) return null;
  return createPortal(<p>{isBody ? "in body" : "elsewhere"}</p>, container);
};

const ObjectRef = () => {
  const ref = useRef<HTMLSpanElement>(null);
  const [tag, setTag] = useState<string | null>(null);
  useLayoutEffect(() => {
    setTag(ref.current ? ref.current.tagName.toLowerCase() : null);
  }, []);
  return <span ref={ref}>{tag === "span" ? <strong>attached</strong> : <em>detached</em>}</span>;
};

export default function BrowserEnvironment() {
  return (
    <main>
      <AddToHomescreen />
      <Responsive />
      <CallbackRefPortal>
        <section>portaled</section>
      </CallbackRefPortal>
      <LayoutEffectContainer />
      <ObjectRef />
    </main>
  );
}
