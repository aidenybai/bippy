import { useSyncExternalStore } from "react";

const subscribe = (): (() => void) => () => {};

const getSnapshot = (): boolean => true;

const getServerSnapshot = (): boolean => false;

export const useIsClient = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
