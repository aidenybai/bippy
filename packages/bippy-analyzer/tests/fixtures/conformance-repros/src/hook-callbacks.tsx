import { useEffect, useLayoutEffect, useState } from "react";
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
