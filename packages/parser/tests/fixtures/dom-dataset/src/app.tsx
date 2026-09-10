import { useLayoutEffect, useState } from "react";

const injectLoader = (name: string, version: string): HTMLScriptElement => {
  const script = document.createElement("script");
  script.dataset.sdkn = name;
  script.dataset.sdkv = version;
  script.dataset.disableAutoTrack = "1";
  document.head.appendChild(script);
  return script;
};

export const App = () => {
  const [tag, setTag] = useState<string | null>(null);
  useLayoutEffect(() => {
    const script = injectLoader("analytics/next", "1.5.0");
    setTag(`${script.dataset.sdkn}@${script.dataset.sdkv}`);
    return () => script.remove();
  }, []);
  if (tag === null) return <p>loading</p>;
  return (
    <main>
      <code>{tag}</code>
      <span>{document.head.querySelector("script[data-disable-auto-track]") ? "on" : "off"}</span>
    </main>
  );
};
