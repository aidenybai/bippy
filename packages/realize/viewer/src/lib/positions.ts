import type { ViewLocation } from "@/model";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LineLookup {
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

const mergeRows = (rects: DOMRect[], origin: DOMRect): Box[] => {
  const rows = new Map<number, DOMRect[]>();
  for (const rect of rects)
    if (rect.width > 0)
      rows.set(Math.round(rect.top), [...(rows.get(Math.round(rect.top)) ?? []), rect]);
  return [...rows.values()].map((group) => {
    const left = Math.min(...group.map((rect) => rect.left));
    const top = Math.min(...group.map((rect) => rect.top));
    const right = Math.max(...group.map((rect) => rect.right));
    const bottom = Math.max(...group.map((rect) => rect.bottom));
    return {
      x: left - origin.left,
      y: top - origin.top,
      width: right - left,
      height: bottom - top,
    };
  });
};

export const getBoundingBox = (rows: Box[]): Box | null => {
  if (rows.length === 0) return null;
  const x = Math.min(...rows.map((row) => row.x));
  const y = Math.min(...rows.map((row) => row.y));
  const right = Math.max(...rows.map((row) => row.x + row.width));
  const bottom = Math.max(...rows.map((row) => row.y + row.height));
  return { x, y, width: right - x, height: bottom - y };
};

const getSpanRows = (
  lookup: LineLookup,
  line: number,
  startColumn: number,
  endColumn: number,
): Box[] => {
  const element = lookup.getLine(line);
  if (!element) return [];
  const nodes = getTextNodes(element);
  if (nodes.length === 0) return [toBox(element.getBoundingClientRect(), lookup.origin)];
  const range = document.createRange();
  setRangePoint(range, nodes, startColumn, false);
  setRangePoint(range, nodes, endColumn, true);
  return mergeRows([...range.getClientRects()], lookup.origin);
};

export const getLocationRows = (lookup: LineLookup, loc: ViewLocation): Box[] => {
  const isSingleLine = loc.start.line === loc.end.line;
  return getSpanRows(
    lookup,
    loc.start.line,
    loc.start.column,
    isSingleLine ? loc.end.column : Number.MAX_SAFE_INTEGER,
  );
};

export const getRangeRows = (lookup: LineLookup, loc: ViewLocation): Box[] =>
  Array.from(
    { length: loc.end.line - loc.start.line + 1 },
    (_, offset) => loc.start.line + offset,
  ).flatMap((line) =>
    getSpanRows(
      lookup,
      line,
      line === loc.start.line ? loc.start.column : 0,
      line === loc.end.line ? loc.end.column : Number.MAX_SAFE_INTEGER,
    ),
  );

export const getLocationBox = (lookup: LineLookup, loc: ViewLocation): Box | null =>
  getBoundingBox(getLocationRows(lookup, loc));

export const getLinesBox = (lookup: LineLookup, loc: ViewLocation): Box | null => {
  const first = getLineBox(lookup, loc.start.line);
  const last = getLineBox(lookup, loc.end.line);
  if (!first || !last) return null;
  return { x: first.x, y: first.y, width: first.width, height: last.y + last.height - first.y };
};
