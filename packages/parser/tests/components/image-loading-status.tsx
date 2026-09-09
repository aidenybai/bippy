import { createContext, useContext, useLayoutEffect, useState } from "react";

/** Radix `Avatar`: the root owns the loading status, the image and the fallback both test it. */
interface AvatarContextValue {
  status: string;
  setStatus: (status: string) => void;
}

const AvatarContext = createContext<AvatarContextValue | null>(null);

const useAvatar = () => {
  const context = useContext(AvatarContext);
  if (!context) throw new Error("Avatar parts must be used within Avatar");
  return context;
};

const Avatar = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState("idle");
  return <AvatarContext.Provider value={{ status, setStatus }}>{children}</AvatarContext.Provider>;
};

const getImageLoadingStatus = (image: HTMLImageElement) =>
  image.complete ? (image.naturalWidth > 0 ? "loaded" : "error") : "loading";

const AvatarImage = ({ src }: { src: string }) => {
  const { status, setStatus } = useAvatar();
  useLayoutEffect(() => {
    const image = new window.Image();
    const handleLoad = (event: Event) => {
      const loaded = event.currentTarget;
      if (loaded instanceof HTMLImageElement) setStatus(getImageLoadingStatus(loaded));
    };
    const handleError = () => setStatus("error");
    image.addEventListener("load", handleLoad);
    image.addEventListener("error", handleError);
    image.src = src;
    setStatus(getImageLoadingStatus(image));
    return () => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
      setStatus("idle");
    };
  }, [src, setStatus]);
  return status === "loaded" ? <img src={src} alt="" /> : null;
};

const AvatarFallback = ({ children }: { children: React.ReactNode }) => {
  const { status } = useAvatar();
  return status !== "loaded" ? <span>{children}</span> : null;
};

export const isPartial = true;

export default function ImageLoadingStatus() {
  return (
    <div>
      <Avatar>
        <AvatarImage src="/one.png" />
        <AvatarFallback>ON</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarImage src="/two.png" />
        <AvatarFallback>TW</AvatarFallback>
      </Avatar>
    </div>
  );
}
