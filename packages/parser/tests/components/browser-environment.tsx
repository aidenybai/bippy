import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

const AddToHomescreen = () => {
  if (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches) {
    return null;
  }
  return <aside>install banner</aside>;
};

const isInstalledApp = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone ||
  document.referrer.includes("android-app://");

const VendorNavigatorPrompt = () => {
  const [isOpen] = useState(true);
  return isOpen && !isInstalledApp() ? <output>install prompt</output> : <></>;
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

const describeAbort = (controller: AbortController): string => {
  const events: string[] = [];
  const onAbort = () => events.push("listener");
  controller.signal.addEventListener("abort", onAbort);
  controller.signal.addEventListener("abort", onAbort);
  controller.signal.addEventListener("abort", () => events.push("second"));
  controller.signal.onabort = (event) => events.push(`handler:${event.type}`);
  const before = controller.signal.aborted;
  controller.abort("done");
  controller.abort("again");
  return `${before},${controller.signal.aborted},${String(controller.signal.reason)},${events.join("+")}`;
};

const Aborts = () => {
  const idle = new AbortController();
  const escaped = new AbortController();
  window.setTimeout(() => escaped.abort(), 0);
  let thrown = "none";
  const aborted = new AbortController();
  aborted.abort(new Error("stop"));
  try {
    aborted.signal.throwIfAborted();
  } catch (error) {
    thrown = error instanceof Error ? error.message : "other";
  }
  return (
    <dl>
      <dd>{describeAbort(new AbortController())}.</dd>
      <dd>{idle.signal.aborted ? "aborted" : "idle"}.</dd>
      <dd>{escaped.signal.aborted ? "aborted" : "idle"}.</dd>
      <dd>{thrown}.</dd>
      <dd>{aborted.signal instanceof AbortSignal ? "signal" : "other"}.</dd>
    </dl>
  );
};

export default function BrowserEnvironment() {
  return (
    <main>
      <AddToHomescreen />
      <VendorNavigatorPrompt />
      <Responsive />
      <CallbackRefPortal>
        <section>portaled</section>
      </CallbackRefPortal>
      <LayoutEffectContainer />
      <ObjectRef />
      <Aborts />
    </main>
  );
}
