interface SegmentNode {
  kind: number;
  depth: number;
  parent: SegmentNode | null;
  static?: Map<string, SegmentNode>;
  dynamic?: SegmentNode[];
  fullPath: string | null;
}

const createNode = (): SegmentNode => ({ kind: 0, depth: 0, parent: null, fullPath: null });

const parseSegment = (path: string, start: number, output = new Uint16Array(6)) => {
  const next = path.indexOf("/", start);
  const end = next === -1 ? path.length : next;
  const part = path.substring(start, end);
  if (!part || !part.includes("$")) {
    output[0] = 0;
    output[1] = start;
    output[2] = start;
    output[3] = end;
    output[4] = end;
    output[5] = end;
    return output;
  }
  if (part.charCodeAt(0) === 36) {
    output[0] = 1;
    output[1] = start;
    output[2] = start + 1;
    output[3] = end;
    output[4] = end;
    output[5] = end;
    return output;
  }
  output[0] = 0;
  output[1] = start;
  output[2] = start;
  output[3] = end;
  output[4] = end;
  output[5] = end;
  return output;
};

const insert = (data: Uint16Array, path: string, root: SegmentNode, caseSensitive: boolean) => {
  let cursor = 1;
  let node = root;
  let depth = 0;
  while (cursor < path.length) {
    const segment = parseSegment(path, cursor, data);
    const end = segment[5];
    cursor = end + 1;
    depth++;
    let nextNode: SegmentNode;
    if (segment[0] === 0) {
      const value = path.substring(segment[2], segment[3]);
      const name = caseSensitive ? value : value.toLowerCase();
      const children = (node.static ??= new Map());
      const existing = children.get(name);
      if (existing) nextNode = existing;
      else {
        nextNode = createNode();
        nextNode.parent = node;
        nextNode.depth = depth;
        children.set(name, nextNode);
      }
    } else {
      const siblings = (node.dynamic ??= []);
      const existing = siblings.find((sibling) => sibling.depth === depth);
      if (existing) nextNode = existing;
      else {
        nextNode = createNode();
        nextNode.kind = 1;
        nextNode.parent = node;
        nextNode.depth = depth;
        siblings.push(nextNode);
      }
    }
    node = nextNode;
  }
  node.fullPath = path;
  return node;
};

const describeTrie = (node: SegmentNode, prefix: string): string[] => {
  const lines = node.fullPath === null ? [] : [`${prefix}=${node.fullPath}`];
  for (const [name, child] of node.static ?? []) {
    lines.push(...describeTrie(child, `${prefix}/${name}`));
  }
  for (const child of node.dynamic ?? []) lines.push(...describeTrie(child, `${prefix}/$`));
  return lines;
};

const countNodes = (root: SegmentNode): number => {
  const queue = [root];
  let count = 0;
  for (;;) {
    const node = queue.shift();
    if (node === void 0) break;
    count++;
    queue.push(...(node.static?.values() ?? []), ...(node.dynamic ?? []));
  }
  return count;
};

export default function SegmentTrie() {
  const data = new Uint16Array(6);
  const root = createNode();
  const leaves = ["/", "/posts", "/posts/$postId", "/posts/", "/Route-A/", "/route-b"].map((path) =>
    insert(data, path, root, false),
  );
  return (
    <ul>
      {describeTrie(root, "").map((line) => (
        <li key={line}>{line}</li>
      ))}
      <li>
        {leaves.length} leaves, deepest {Math.max(...leaves.map((leaf) => leaf.depth))},{" "}
        {countNodes(root)} nodes
      </li>
      <li>
        {[
          "a/b/c".indexOf("/", 2),
          "a/b/c".lastIndexOf("/", 2),
          "abc".includes("a", 1),
          "abc".startsWith("b", 1),
          "abc".endsWith("b", 2),
          [1, 2, 1].indexOf(1, 1),
          [1, 2, 1].includes(2, -1),
        ].join(",")}
      </li>
    </ul>
  );
}
