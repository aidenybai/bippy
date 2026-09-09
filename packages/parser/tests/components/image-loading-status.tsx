import { useLayoutEffect, useState } from "react";

type ImageLoadingStatus = "idle" | "loading" | "loaded" | "error";

const useImageLoadingStatus = (src: string | undefined): ImageLoadingStatus => {
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
    image.onload = updateStatus("loaded");
    image.onerror = updateStatus("error");
    image.src = src;
    return () => {
      isMounted = false;
    };
  }, [src]);
  return loadingStatus;
};

const Avatar = ({ src, initials }: { src?: string; initials: string }) => {
  const status = useImageLoadingStatus(src);
  return (
    <span>
      {status === "loaded" ? <img src={src} alt="" /> : null}
      {status !== "loaded" ? <b>{initials}</b> : null}
    </span>
  );
};

export const isPartial = true;

export default function ImageLoadingStatus() {
  return (
    <main>
      <Avatar src="/one.png" initials="A" />
      <Avatar src="/one.png" initials="B" />
      <Avatar src="/two.png" initials="C" />
      <Avatar initials="D" />
    </main>
  );
}
