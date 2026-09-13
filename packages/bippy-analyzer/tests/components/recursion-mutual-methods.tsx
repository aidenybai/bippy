export const isExact = true;

interface Segment {
  text: string;
  children: Segment[];
}

class Outline {
  root: Segment;
  visited: string[];
  constructor(root: Segment) {
    this.root = root;
    this.visited = [];
  }
  flatten(): string[] {
    this.visited = [];
    this.visitSegment(this.root, 0);
    return this.visited;
  }
  visitSegment(segment: Segment, depth: number): void {
    this.visited.push(`${depth}:${segment.text}`);
    this.visitChildren(segment.children, depth + 1);
  }
  visitChildren(children: Segment[], depth: number): void {
    for (const child of children) this.visitSegment(child, depth);
  }
  countEven(value: number): boolean {
    return value === 0 ? true : this.countOdd(value - 1);
  }
  countOdd(value: number): boolean {
    return value === 0 ? false : this.countEven(value - 1);
  }
}

const outline = new Outline({
  text: "root",
  children: [
    { text: "intro", children: [{ text: "hook", children: [] }] },
    { text: "body", children: [{ text: "point", children: [{ text: "detail", children: [] }] }] },
  ],
});

export default function RecursionMutualMethods() {
  const flattened = outline.flatten();
  return (
    <section>
      <ul>
        {flattened.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
      <output>{outline.countEven(6) ? "even" : "odd"}</output>
      <b>{outline.countOdd(6) ? "odd" : "even"}</b>
    </section>
  );
}
