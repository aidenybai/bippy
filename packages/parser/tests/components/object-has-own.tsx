class Node {
  type = "element";
}

const plain: Record<string, string | undefined> = { tagName: "div", className: undefined };
const list = ["first"];
const node = new Node();
const nullPrototype: Record<string, boolean> = Object.create(null);
nullPrototype.flag = true;

const facts = [
  `plain:${Object.hasOwn(plain, "tagName")},${Object.hasOwn(plain, "className")},${Object.hasOwn(plain, "toString")}`,
  `list:${Object.hasOwn(list, 0)},${Object.hasOwn(list, "length")},${Object.hasOwn(list, 1)}`,
  `class:${Object.hasOwn(node, "type")},${Object.hasOwn(node, "constructor")}`,
  `null-prototype:${Object.hasOwn(nullPrototype, "flag")},${Object.hasOwn(nullPrototype, "missing")}`,
];

export const isExact = true;

export default function ObjectHasOwn() {
  return (
    <ul>
      {facts.map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}
