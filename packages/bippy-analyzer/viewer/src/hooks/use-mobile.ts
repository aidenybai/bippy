import { useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

const subscribe = (onChange: () => void): (() => void) => {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

const getSnapshot = (): boolean => window.matchMedia(MOBILE_QUERY).matches;

export const useIsMobile = (): boolean => useSyncExternalStore(subscribe, getSnapshot);
