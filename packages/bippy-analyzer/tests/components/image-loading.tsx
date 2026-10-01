import { useEffect, useState } from "react";

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type Status = "pending" | "loading" | "loaded" | "failed";

const useImageStatus = (source: string): Status => {
  const [status, setStatus] = useState<Status>("pending");
  useEffect(() => {
    setStatus("loading");
    const image = new Image();
    image.onload = () => setStatus("loaded");
    image.onerror = () => setStatus("failed");
    image.addEventListener("load", () => image.classList.add("seen"));
    image.src = source;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [source]);
  return status;
};

export default function ImageLoading() {
  const status = useImageStatus(PIXEL);
  return (
    <figure data-status={status}>
      {status === "loaded" ? <img src={PIXEL} alt="pixel" /> : <span>{status}</span>}
    </figure>
  );
}

export const isExact = true;
