const agent = navigator.userAgent;

const edges: Record<string, string[]> = {
  root: ["left", "right"],
  left: ["leaf"],
  right: ["leaf"],
  leaf: [],
};

let visited: Set<string> | undefined;

const visit = (node: string) => {
  if (visited?.has(node)) return;
  visited?.add(node);
  for (const next of edges[node]) visit(next);
};

const countReachable = (root: string) => {
  try {
    visited = new Set();
    visit(root);
    return visited.size;
  } finally {
    visited = undefined;
  }
};

const countWhenMozilla = () => {
  if (agent.includes("M")) {
    if (agent.includes("o")) {
      if (agent.includes("z")) {
        if (agent.includes("i")) {
          if (agent.includes("l")) {
            if (agent.includes("a")) {
              let total = 0;
              for (let index = 0; index < 3; index++) total += countReachable("root");
              return total;
            }
          }
        }
      }
    }
  }
  return 0;
};

export const isPartial = true;

export default function DeeplyNestedCleanup() {
  const total = countWhenMozilla();
  return (
    <p>
      {total === 12 ? <b>all reached</b> : <i>{total}</i>}
      {visited === undefined ? <em>clean</em> : <strong>leaked</strong>}
    </p>
  );
}
