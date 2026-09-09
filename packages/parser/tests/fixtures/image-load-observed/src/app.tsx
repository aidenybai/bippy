import { useLayoutEffect, useState } from "react";

type ImageLoadingStatus = "idle" | "loading" | "loaded" | "error";

const LOADED_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const useHandlerImageStatus = (src: string | undefined): ImageLoadingStatus => {
  const [loadingStatus, setLoadingStatus] = useState<ImageLoadingStatus>("idle");

  useLayoutEffect(() => {
    if (!src) {
      setLoadingStatus("error");
      return;
    }
    let isMounted = true;
    const image = new window.Image();
    const updateStatus = (status: ImageLoadingStatus) => () => {
      if (!isMounted) return;
      setLoadingStatus(status);
    };
    setLoadingStatus("loading");
    image.onload = updateStatus("idle");
    image.onload = updateStatus("loaded");
    image.onerror = updateStatus("error");
    image.src = src;
    return () => {
      isMounted = false;
    };
  }, [src]);

  return loadingStatus;
};

const useListenerImageStatus = (src: string): ImageLoadingStatus => {
  const [loadingStatus, setLoadingStatus] = useState<ImageLoadingStatus>("loading");

  useLayoutEffect(() => {
    const image = new Image();
    image.addEventListener("load", () => setLoadingStatus("loaded"));
    image.addEventListener("error", () => setLoadingStatus("error"));
    image.src = src;
  }, [src]);

  return loadingStatus;
};

const Picture = ({
  src,
  status,
  initials,
}: {
  src?: string;
  status: ImageLoadingStatus;
  initials: string;
}) => <span>{status === "loaded" ? <img src={src} alt="" /> : <b>{initials}</b>}</span>;

const HandlerAvatar = ({ src, initials }: { src?: string; initials: string }) => (
  <Picture src={src} status={useHandlerImageStatus(src)} initials={initials} />
);

const ListenerAvatar = ({ src, initials }: { src: string; initials: string }) => (
  <Picture src={src} status={useListenerImageStatus(src)} initials={initials} />
);

export const App = () => (
  <main>
    <HandlerAvatar src={LOADED_PIXEL} initials="A" />
    <HandlerAvatar src="/missing.png" initials="B" />
    <HandlerAvatar src="/unobserved.png" initials="C" />
    <HandlerAvatar initials="D" />
    <ListenerAvatar src={LOADED_PIXEL} initials="E" />
    <ListenerAvatar src="/missing.png" initials="F" />
  </main>
);
