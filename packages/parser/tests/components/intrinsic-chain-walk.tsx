class Node {
  static getType(): string {
    return "node";
  }
}

class ElementNode extends Node {
  static getType(): string {
    return "element";
  }
}

class ParagraphNode extends ElementNode {
  static getType(): string {
    return "paragraph";
  }
}

const collectTypes = (klass: typeof Node): string[] => {
  const types: string[] = [];
  for (
    let current: unknown = klass;
    typeof current === "function" &&
    current.prototype &&
    current.prototype.constructor.getType !== undefined;
    current = Object.getPrototypeOf(current)
  ) {
    types.push(current.prototype.constructor.getType());
  }
  return types;
};

const intrinsicFacts = [
  Function.prototype.prototype === undefined,
  Object.getPrototypeOf(Node) === Function.prototype,
  "getType" in Function.prototype,
  Math.nonexistent === undefined,
  JSON.nonexistent === undefined,
  typeof Array.prototype.nonexistent,
];

export const isExact = true;

export default function IntrinsicChainWalk() {
  return (
    <section>
      <ul>
        {collectTypes(ParagraphNode).map((type) => (
          <li key={type}>{type}</li>
        ))}
      </ul>
      <ol>
        {intrinsicFacts.map((fact, index) => (
          <li key={index}>{String(fact)}</li>
        ))}
      </ol>
    </section>
  );
}
