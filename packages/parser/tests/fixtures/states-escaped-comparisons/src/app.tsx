import { createContext, useContext, useLayoutEffect, useState } from "react";

interface PanelContextValue {
  status: string;
  setStatus: (status: string) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

const usePanel = () => {
  const context = useContext(PanelContext);
  if (!context) throw new Error("Panel parts must be used within Panel");
  return context;
};

const Panel = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState("idle");
  return <PanelContext.Provider value={{ status, setStatus }}>{children}</PanelContext.Provider>;
};

const getImageStatus = (image: HTMLImageElement) =>
  image.complete ? (image.naturalWidth > 0 ? "loaded" : "error") : "loading";

const Picture = ({ src }: { src: string }) => {
  const { status, setStatus } = usePanel();
  useLayoutEffect(() => {
    const image = new window.Image();
    const handleLoad = (event: Event) => {
      if (event.currentTarget instanceof HTMLImageElement) {
        setStatus(getImageStatus(event.currentTarget));
      }
    };
    image.addEventListener("load", handleLoad);
    image.src = src;
    setStatus("loading");
    return () => {
      image.removeEventListener("load", handleLoad);
      setStatus("idle");
    };
  }, [src, setStatus]);
  return status === "loaded" ? <img src={src} alt="" /> : null;
};

const Placeholder = () => {
  const { status } = usePanel();
  return status !== "loaded" ? <p>loading</p> : null;
};

const PANELS = ["one", "two", "three", "four", "five", "six", "seven"];

export const App = () => (
  <main>
    {PANELS.map((name) => (
      <Panel key={name}>
        <Picture src={`/pictures/${name}.png`} />
        <Placeholder />
      </Panel>
    ))}
  </main>
);
