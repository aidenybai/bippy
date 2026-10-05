declare const global: typeof globalThis;

/** lodash's `_root`: the first defined global object, with webpack filling in `global`. */
const freeGlobal = typeof global === "object" && global && global.Object === Object && global;
const freeSelf = typeof self === "object" && self && self.Object === Object && self;
export const root = freeGlobal || freeSelf || Function("return this")();

export const describeRoot = (): string =>
  [
    typeof global,
    global === globalThis,
    global === window,
    self === globalThis,
    window.self === window,
    typeof global.setTimeout,
    root === window,
    typeof root.Object,
    freeGlobal === global,
  ].join(" ");
