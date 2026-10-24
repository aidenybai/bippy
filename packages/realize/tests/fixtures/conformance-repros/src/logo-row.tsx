import { useEffect, useState } from "react";

/**
 * A child that reports from an effect, after its image candidates all fail, through a callback
 * prop that sets the parent's state.
 */

// libretv src/components/live-channel-list.tsx
const SmartImage = ({ url, onExhausted }: { url: string; onExhausted?: () => void }) => {
  const candidates = [url, `${url}?retry`];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (index >= candidates.length) onExhausted?.();
  }, [index, candidates.length, onExhausted]);
  if (index >= candidates.length) return null;
  return <img src={candidates[index]} alt="" onError={() => setIndex((current) => current + 1)} />;
};

export function LogoRow({
  name,
  logo,
  onSelect,
}: {
  name: string;
  logo?: string;
  onSelect: (name: string) => void;
}) {
  const [isLogoFailed, setIsLogoFailed] = useState(false);
  useEffect(() => setIsLogoFailed(false), [logo]);
  return (
    <div onClick={() => onSelect(name)}>
      {logo && !isLogoFailed ? (
        <SmartImage url={logo} onExhausted={() => setIsLogoFailed(true)} />
      ) : (
        <span>{name.slice(0, 1)}</span>
      )}
      <span>{name}</span>
    </div>
  );
}
