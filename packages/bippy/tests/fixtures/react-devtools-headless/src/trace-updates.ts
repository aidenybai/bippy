export interface TraceUpdateRectangle {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface TraceUpdateData {
  color: string;
  count: number;
  displayName: string;
  rect?: TraceUpdateRectangle | null;
}

export const groupAndSortNodes = (nodes: Map<unknown, TraceUpdateData>): TraceUpdateData[][] => {
  const groups = new Map<string, TraceUpdateData[]>();
  for (const data of nodes.values()) {
    if (!data.rect) continue;
    const key = `${data.rect.left},${data.rect.top}`;
    const group = groups.get(key);
    if (group) group.push(data);
    else groups.set(key, [data]);
  }
  return [...groups.values()].sort((left, right) => {
    const leftMinimum = Math.min(...left.map((data) => data.count));
    const rightMinimum = Math.min(...right.map((data) => data.count));
    return leftMinimum - rightMinimum;
  });
};
