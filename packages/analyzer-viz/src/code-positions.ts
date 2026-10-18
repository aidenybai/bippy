import type { ViewLocation } from "./model";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
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

export const getLineBox = (container: HTMLElement, line: number): Box | null => {
  const element = container.querySelectorAll(".line")[line - 1];
  if (!element) return null;
  return toBox(element.getBoundingClientRect(), container.getBoundingClientRect());
};

export const getSpanBox = (
  container: HTMLElement,
  line: number,
  startColumn: number,
  endColumn: number,
): Box | null => {
  const element = container.querySelectorAll(".line")[line - 1];
  if (!element) return null;
  const nodes = getTextNodes(element);
  if (nodes.length === 0) return getLineBox(container, line);
  const range = document.createRange();
  setRangePoint(range, nodes, startColumn, false);
  setRangePoint(range, nodes, endColumn, true);
  return toBox(range.getBoundingClientRect(), container.getBoundingClientRect());
};

export const getLocationBox = (container: HTMLElement, loc: ViewLocation): Box | null => {
  const isSingleLine = loc.start.line === loc.end.line;
  return getSpanBox(
    container,
    loc.start.line,
    loc.start.column,
    isSingleLine ? loc.end.column : Number.MAX_SAFE_INTEGER,
  );
};

export const getLinesBox = (container: HTMLElement, loc: ViewLocation): Box | null => {
  const first = getLineBox(container, loc.start.line);
  const last = getLineBox(container, loc.end.line);
  if (!first || !last) return null;
  return { x: 0, y: first.y, width: container.scrollWidth, height: last.y + last.height - first.y };
};
