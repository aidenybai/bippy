interface Bippy {
  _fiberRoots: Set<unknown>;
  specTree: string;
}

declare module 'bippy/dist/index.global.js' {
  const content: string;
  export default content;
}

declare global {
  var Bippy: Bippy;

  interface Window {
    Bippy: Bippy;
  }
}

export {};
