import { useEffect, useState } from "react";

const trace: string[] = [];
export default () => {
  const [text, setText] = useState("waiting");
  useEffect(() => {
    const element = document.createElement("div");
    element.dataset.dynamic = "live";
    document.body.append(element);
    localStorage.setItem("name", "stored");
    const source = { name: "original" };
    const clone = structuredClone({ source, alias: source, map: new Map([[source, source]]) });
    clone.source.name = "clone";
    const bytes = new TextEncoder().encode("héllo");
    trace.push(
      `${globalThis === window}:${element.ownerDocument.defaultView === window}:${element.dataset.dynamic}`,
    );
    trace.push(
      `${source.name}:${clone.source === clone.alias}:${clone.map.get(clone.source) === clone.source}`,
    );
    trace.push(
      `${new TextDecoder().decode(bytes)}:${ArrayBuffer.isView(bytes)}:${new URL("/path?value=7", location.href).searchParams.get("value")}`,
    );
    const cancelled = setTimeout(() => trace.push("cancelled"), 1);
    clearTimeout(cancelled);
    const observer = new MutationObserver(() => trace.push("mutation"));
    observer.observe(element, { attributes: true });
    element.setAttribute("data-change", "yes");
    setTimeout(() => trace.push(`timer:${Date.now()}:${performance.now()}`), 5);
    requestAnimationFrame((time) => trace.push(`frame:${time}`));
    void fetch("/payload")
      .then((response) => response.json())
      .then((value: { name: string }) => setText(`${value.name}:${localStorage.getItem("name")}`));
    return () => {
      observer.disconnect();
      element.remove();
      trace.push("cleanup");
    };
  }, []);
  return <output>{text}</output>;
};
export const getTrace = () => trace;
