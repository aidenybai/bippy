import * as React from "react";
import { Fragment } from "react";
import type { ComponentType, ReactNode } from "react";
import { EventEmitter } from "./events";

const layouts: Record<string, ComponentType<{ children: ReactNode }>> = {
  compact: Fragment,
  wide: React.Fragment,
};

const emitters: Record<string, typeof EventEmitter> = {
  fast: EventEmitter,
  safe: EventEmitter,
};

const mode = window.location.hash.slice(1) || "compact";
const emitterMode = window.location.search.includes("safe") ? "safe" : "fast";

export const App = () => {
  const Layout = layouts[mode] ?? Fragment;
  const emitter = new emitters[emitterMode]();
  return (
    <Layout>
      <main>{emitter instanceof EventEmitter ? <b>emitter</b> : <i>other</i>}</main>
    </Layout>
  );
};
