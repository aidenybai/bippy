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

function* walkStaticChain(klass: typeof Node): Iterable<typeof Node> {
  for (let current: typeof Node | null = klass; current !== null;) {
    yield current;
    const parent = Object.getPrototypeOf(current);
    current = parent === Function.prototype ? null : parent;
  }
}

function* numbered(prefix: string, count: number): Generator<string, number> {
  for (let index = 0; index < count; index++) yield `${prefix}${index}`;
  return count;
}

function* combined(): Generator<string> {
  yield* numbered("a", 2);
  yield "middle";
  yield* ["x", "y"];
}

const typeNames = new Set<string>();
for (const { getType } of walkStaticChain(ParagraphNode)) {
  if (!typeNames.has(getType())) typeNames.add(getType());
}

const stepper = numbered("s", 2);
const steps = [stepper.next(), stepper.next(), stepper.next(), stepper.next()];

const spread = [...combined()];
const fromGenerator = Array.from(combined(), (item) => item.toUpperCase());
const drained = combined();
for (const _item of drained) {
  // consume
}
const afterDrain = [...drained];

export default function Generators() {
  return (
    <ul>
      <li>chain: {[...typeNames].join(",")}</li>
      <li>steps: {steps.map((step) => `${String(step.value)}:${step.done}`).join(" ")}</li>
      <li>spread: {spread.join(",")}</li>
      <li>from: {fromGenerator.join(",")}</li>
      <li>drained: {afterDrain.length}</li>
    </ul>
  );
}
