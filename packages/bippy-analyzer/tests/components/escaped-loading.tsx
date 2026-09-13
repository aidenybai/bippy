import { useEffect, useState } from "react";

interface Loaded {
  width: number;
}

const decode = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.src = url;
  });

const whenLoaded = async (url: string): Promise<Loaded> => {
  const image = await decode(url);
  return { width: image.naturalWidth };
};

const loadAll = async (urls: string[]): Promise<{ images: Loaded[] }> => {
  const images = await Promise.all(urls.map((url) => whenLoaded(url)));
  return { images };
};

const Gallery = () => {
  const [result, setResult] = useState<{ images: Loaded[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    const run = async () => {
      try {
        setResult(await loadAll(["/a.png", "/b.png"]));
      } finally {
        setIsLoading(false);
      }
    };
    run();
  }, []);
  const images = result?.images;
  if (isLoading) return <progress />;
  if (!images) return <em>nothing</em>;
  return (
    <ul>
      {images.map((image) => (
        <li key={image.width} />
      ))}
    </ul>
  );
};

const Delayed = () => {
  const [result, setResult] = useState<{ isReady: boolean } | null>(null);
  useEffect(() => {
    const delay = Math.random() < 0.5 ? 0 : 1;
    const handle = setTimeout(() => setResult({ isReady: true }), delay);
    return () => clearTimeout(handle);
  }, []);
  const isReady = result?.isReady;
  if (!isReady) return <em>waiting</em>;
  return (
    <ol>
      <li />
    </ol>
  );
};

export default function EscapedLoading() {
  return (
    <main>
      <Gallery />
      <Delayed />
    </main>
  );
}
