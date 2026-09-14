let keyCounter = 1;

const generateKey = (): string => "" + keyCounter++;

const nodeMap = new Map<string, RegistryNode>();

const editor = { dirtyType: 0 };

class RegistryNode {
  __key: string;
  __label: string;

  constructor(label: string) {
    const key = generateKey();
    nodeMap.set(key, this);
    if (editor.dirtyType === 0) {
      editor.dirtyType = 1;
    }
    this.__key = key;
    this.__label = label;
  }

  getLatest(): RegistryNode {
    const latest = nodeMap.get(this.__key);
    if (latest === undefined) {
      throw new Error("missing node");
    }
    return latest;
  }
}

const isEnabled = (): boolean => window.localStorage.getItem("flag") !== null;

const createNodes = (): RegistryNode[] => {
  if (isEnabled()) {
    editor.dirtyType = 2;
  }
  return ["a", "b", "c", "d"].map((label) => new RegistryNode(label));
};

const nodes = createNodes();

const describeNodes = (): string =>
  nodes
    .map((node) => `${node.getLatest().__key}:${node.getLatest().getLatest().__label}`)
    .join(",");

export default function App() {
  return (
    <section>
      <span>{describeNodes()} </span>
      <span>{String(nodeMap.size)} </span>
    </section>
  );
}
