import { useEffect, useState } from "react";

type LoadState = false | "loaded" | "error";

interface ImageSource {
  src?: string;
  srcSet?: string;
}

const useLoaded = ({ src, srcSet }: ImageSource): LoadState => {
  const [loaded, setLoaded] = useState<LoadState>(false);
  useEffect(() => {
    if (!src && !srcSet) return undefined;
    setLoaded(false);
    let isActive = true;
    const image = new Image();
    image.onload = () => {
      if (isActive) setLoaded("loaded");
    };
    image.onerror = () => {
      if (isActive) setLoaded("error");
    };
    image.crossOrigin = null;
    if (src) image.src = src;
    if (srcSet) image.srcset = srcSet;
    return () => {
      isActive = false;
    };
  }, [src, srcSet]);
  return loaded;
};

const Avatar = ({ src, srcSet, initials }: ImageSource & { initials: string }) => {
  const loaded = useLoaded({ src, srcSet });
  const hasImage = src || srcSet;
  if (hasImage && loaded === "loaded") return <img src={src} srcSet={srcSet} alt="" />;
  if (hasImage && loaded !== "error") return <div role="img" />;
  return <span>{initials}</span>;
};

export default function ImagePreload() {
  return (
    <main>
      <Avatar src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" initials="AB" />
      <Avatar src="/shared/pixel.svg" initials="CD" />
      <Avatar srcSet="/shared/pixel.svg 1x, /shared/pixel.svg?dpr=2 2x" initials="EF" />
      <Avatar initials="GH" />
    </main>
  );
}

export const isExact = true;
