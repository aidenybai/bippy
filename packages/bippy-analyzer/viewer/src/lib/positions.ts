import type { ViewLocation } from "../model";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LineLookup {
  origin: DOMRect;
  getLine: (line: number) => Element | null;
}

const getTextNodes = (element: Element): Text[] => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node instanceof Text) nodes.push(node);
  return nodes;
};

const setRangePoint = (range: Range, nodes: Text[], column: number, isEnd: boolean): void => {
  let offset = 0;
  for (const node of nodes) {
    const length = node.data.length;
    if (column <= offset + length) {
      if (isEnd) range.setEnd(node, column - offset);
      else range.setStart(node, column - offset);
      return;
    }
    offset += length;
  }
  const last = nodes.at(-1);
  if (!last) return;
  if (isEnd) range.setEnd(last, last.data.length);
  else range.setStart(last, last.data.length);
};

const toBox = (rect: DOMRect, origin: DOMRect): Box => ({
  x: rect.left - origin.left,
  y: rect.top - origin.top,
  width: rect.width,
  height: rect.height,
});

export const getLineFromEvent = (event: Event): number | null => {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    const line = target.getAttribute("data-line");
    if (line !== null) return Number(line);
  }
  return null;
};

export const scrollToLine = (host: HTMLElement, line: number): void => {
  const root: ParentNode = host.shadowRoot ?? host;
  root
    .querySelector(`[data-line="${line}"]`)
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
};

export const createLineLookup = (host: HTMLElement, origin: HTMLElement): LineLookup => {
  const root: ParentNode = host.shadowRoot ?? host;
  const lines = new Map<number, Element | null>();
  return {
    origin: origin.getBoundingClientRect(),
    getLine: (line) => {
      const cached = lines.get(line);
      if (cached !== undefined) return cached;
      const element = root.querySelector(`[data-line="${line}"]`);
      lines.set(line, element);
      return element;
    },
  };
};

const getLineBox = (lookup: LineLookup, line: number): Box | null => {
  const element = lookup.getLine(line);
  return element ? toBox(element.getBoundingClientRect(), lookup.origin) : null;
};

const getSpanBox = (
  lookup: LineLookup,
  line: number,
  startColumn: number,
  endColumn: number,
): Box | null => {
  const element = lookup.getLine(line);
  if (!element) return null;
  const nodes = getTextNodes(element);
  if (nodes.length === 0) return getLineBox(lookup, line);
  const range = document.createRange();
  setRangePoint(range, nodes, startColumn, false);
  setRangePoint(range, nodes, endColumn, true);
  return toBox(range.getBoundingClientRect(), lookup.origin);
};

export const getLocationBox = (lookup: LineLookup, loc: ViewLocation): Box | null => {
  const isSingleLine = loc.start.line === loc.end.line;
  return getSpanBox(
    lookup,
    loc.start.line,
    loc.start.column,
    isSingleLine ? loc.end.column : Number.MAX_SAFE_INTEGER,
  );
};

export const getLinesBox = (lookup: LineLookup, loc: ViewLocation): Box | null => {
  const first = getLineBox(lookup, loc.start.line);
  const last = getLineBox(lookup, loc.end.line);
  if (!first || !last) return null;
  return { x: first.x, y: first.y, width: first.width, height: last.y + last.height - first.y };
};
