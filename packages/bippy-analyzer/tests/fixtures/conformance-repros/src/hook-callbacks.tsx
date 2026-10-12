import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export const Overlay = ({ container }: { container?: Element | null }) => {
  const [mounted, setMounted] = useState(false);
  useIsomorphicLayoutEffect(() => setMounted(true), []);
  const target = container ?? (mounted ? document.body : null);
  return target ? createPortal(<p>overlay</p>, target) : null;
};

declare const handleSubmit: (onValid: (data: unknown) => void) => () => void;

export const SignUp = () => {
  const [isLoading, setIsLoading] = useState(false);
  const onSubmit = () => setIsLoading(true);
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <button disabled={isLoading}>{isLoading ? "Saving" : "Sign up"}</button>
    </form>
  );
};

declare const mutateAsync: (data: string, options: { onSuccess: (key: string) => void }) => void;

export const ApiKeyForm = () => {
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  return createdKey ? (
    <p>{createdKey}</p>
  ) : (
    <button onClick={() => mutateAsync("key", { onSuccess: (key) => setCreatedKey(key) })}>
      Create
    </button>
  );
};

export const Truncated = ({ text }: { text: string }) => {
  const [isOverflown, setIsOverflown] = useState(false);
  const refCallback = (node: HTMLDivElement | null) => {
    if (node && node.scrollWidth > node.clientWidth) setIsOverflown(true);
  };
  return isOverflown ? <abbr title={text}>{text}</abbr> : <div ref={refCallback}>{text}</div>;
};

const Regions = ({ children }: { children: (codes: string[]) => React.ReactNode }) => (
  <svg>{children(["FR", "JP"])}</svg>
);

export const RegionMap = () => {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div>
      <Regions>
        {(codes) => codes.map((code) => <path key={code} onMouseOver={() => setHovered(code)} />)}
      </Regions>
      {hovered ? <p>{hovered}</p> : null}
    </div>
  );
};

declare const recognition: { onresult: ((text: string) => void) | null; start: () => void };

export const Dictation = () => {
  const [transcript, setTranscript] = useState("");
  const listen = () => {
    recognition.onresult = (text) => setTranscript(text);
    recognition.start();
  };
  return transcript ? <p>{transcript}</p> : <button onClick={listen}>Listen</button>;
};

export const Reactions = () => {
  const [current, setCurrent] = useState<string | null>(null);
  const Emoji = ({ emoji }: { emoji: string }) => (
    <button onClick={() => setCurrent(emoji)}>{emoji}</button>
  );
  return (
    <div>
      <Emoji emoji="❤️" />
      {current ? <p>{current}</p> : null}
    </div>
  );
};

export const Seeker = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    setTime(Number(event.target.value));
  };
  return (
    <div>
      <video ref={videoRef} />
      <input onChange={handleSeek} />
      {time > 0 ? <p>Seeked</p> : <p>Start</p>}
    </div>
  );
};
