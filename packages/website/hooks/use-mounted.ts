"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export const useMounted = () => {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
