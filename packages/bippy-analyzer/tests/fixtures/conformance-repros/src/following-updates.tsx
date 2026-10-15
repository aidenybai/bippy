import { useEffect, useState } from "react";
import { useAction } from "action-hooks";

export const DismissibleBanner = () => {
  const [isOpen, setIsOpen] = useState(true);
  const dismissAction = useAction({ onExecute: () => setIsOpen(false) });
  if (!isOpen) return null;
  return (
    <button type="button" onClick={() => dismissAction.execute()}>
      Dismiss
    </button>
  );
};

export const HeightResult = () => {
  const [height, setHeight] = useState(170);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    setResult(height > 0 ? "Healthy" : null);
  }, [height]);
  return (
    <div>
      <button type="button" onClick={() => setHeight(0)}>
        Reset
      </button>
      {result ? <p>{result}</p> : null}
    </div>
  );
};

export const LazyImage = ({ src }: { src: string }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  if (hasFailed) return <a href={src}>Image</a>;
  if (isLoaded) return <img src={src} alt="" onError={() => setHasFailed(true)} />;
  return (
    <button type="button" onClick={() => setIsLoaded(true)}>
      Load
    </button>
  );
};
