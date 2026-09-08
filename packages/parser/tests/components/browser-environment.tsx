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

const Viewport = () => {
  const isMobile = window.innerWidth < 768;
  const isShort = globalThis.innerHeight < 600;
  const isRetina = window.devicePixelRatio > 1;
  return (
    <header>
      {isMobile ? <menu>mobile</menu> : <ul>desktop</ul>}
      {isShort ? <small>short</small> : <big>tall</big>}
      {isRetina ? <b>retina</b> : <i>standard</i>}
    </header>
  );
};

const readStoredMode = (raw: string | null): string => {
  if (raw === null) return "unset";
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : "invalid";
  } catch (error) {
    return error instanceof SyntaxError ? "syntax-error" : "other-error";
  }
};

const StoredModes = () => (
  <ol>
    <li>{readStoredMode('"multi"') === "multi" ? <b>multi</b> : <i>other</i>}</li>
    <li>{readStoredMode("") === "syntax-error" ? <b>threw</b> : <i>parsed</i>}</li>
    <li>{readStoredMode("{oops") === "syntax-error" ? <b>threw</b> : <i>parsed</i>}</li>
    <li>{readStoredMode(null)}</li>
  </ol>
);

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
      <Responsive />
      <Viewport />
      <StoredModes />
      <CallbackRefPortal>
        <section>portaled</section>
      </CallbackRefPortal>
      <LayoutEffectContainer />
      <ObjectRef />
      <Aborts />
    </main>
  );
}
