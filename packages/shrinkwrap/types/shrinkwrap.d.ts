interface ShrinkwrapData {
  elementMap: Map<number, Set<Element>>;
}

declare global {
  var ShrinkwrapData: ShrinkwrapData;
  interface Window {
    ShrinkwrapData: ShrinkwrapData;
  }
}

export {};
