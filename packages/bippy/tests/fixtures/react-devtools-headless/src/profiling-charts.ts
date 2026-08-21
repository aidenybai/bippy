export interface ProfilingChartNode {
  actualDuration: number;
  children: number[];
  didRender: boolean;
  id: number;
  key?: string;
  name: string;
  parentId: number | null;
  selfDuration: number;
  treeBaseDuration: number;
}

export interface RankedChartNode {
  id: number;
  label: string;
  name: string;
  value: number;
}

export interface FlameChartNode extends ProfilingChartNode {
  offset: number;
}

const formatDuration = (duration: number): string => (duration < 0.1 ? "<0.1ms" : `${duration}ms`);

export const getRankedChartData = (nodes: ProfilingChartNode[]): RankedChartNode[] =>
  nodes
    .filter((node) => node.didRender && node.parentId !== null)
    .map((node) => ({
      id: node.id,
      label: `${node.name}${node.key ? ` key="${node.key}"` : ""} (${formatDuration(node.selfDuration)})`,
      name: node.name,
      value: node.selfDuration,
    }))
    .sort((left, right) => right.value - left.value);

export const getFlamegraphChartData = (nodes: ProfilingChartNode[]): FlameChartNode[][] => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const rows: FlameChartNode[][] = [];
  const visit = (node: ProfilingChartNode, depth: number, offset: number): void => {
    const row = rows[depth] ?? [];
    row.push({ ...node, offset });
    rows[depth] = row;
    const children = node.children
      .map((childId) => nodesById.get(childId))
      .filter((child): child is ProfilingChartNode => child !== undefined);
    const childrenBaseDuration = children.reduce(
      (totalBaseDuration, child) => totalBaseDuration + child.treeBaseDuration,
      0,
    );
    let childOffset = offset + node.treeBaseDuration - childrenBaseDuration;
    for (const child of children) {
      visit(child, depth + 1, childOffset);
      childOffset += child.treeBaseDuration;
    }
  };
  for (const node of nodes) {
    if (node.parentId === null) visit(node, 0, 0);
  }
  return rows;
};
