export const scrollToStart = (element: Element | null | undefined): void =>
  element?.scrollIntoView({ block: "start", behavior: "smooth" });

export const findComponentElement = (container: ParentNode | null, name: string): Element | null =>
  container?.querySelector(`[data-component="${CSS.escape(name)}"]`) ?? null;
