/** Prism-style grammar bookkeeping: `Object.defineProperty` tags, `for..in` over arrays and objects, `Object.prototype.toString` type names. */
interface Grammar {
  [token: string]: Grammar | RegExp | Grammar[] | number | undefined;
}

let nextId = 0;

const getObjectId = (target: object & { __id?: number }): number => {
  if (!target.__id) Object.defineProperty(target, "__id", { value: ++nextId });
  return target.__id ?? 0;
};

const getTypeName = (value: unknown): string => Object.prototype.toString.call(value).slice(8, -1);

const listOwnKeys = (target: object): string[] => {
  const keys: string[] = [];
  for (const key in target) if (Object.prototype.hasOwnProperty.call(target, key)) keys.push(key);
  return keys;
};

const grammar: Grammar = {
  comment: /\/\/.*/,
  keywords: [{ pattern: /const/ }, { pattern: /let/ }],
  nested: { punctuation: /[{}]/ },
};

const visit = (target: object, visited: Record<number, boolean>, out: string[]): void => {
  for (const key in target) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
    const property = target[key as keyof typeof target];
    const typeName = getTypeName(property);
    out.push(`${key}:${typeName}`);
    if ((typeName === "Object" || typeName === "Array") && !visited[getObjectId(property)]) {
      visited[getObjectId(property)] = true;
      visit(property, visited, out);
    }
  }
};

const TaggedKeys = () => {
  const tagged = { alpha: 1, beta: 2 };
  const taggedList = [/a/, /b/];
  getObjectId(tagged);
  getObjectId(taggedList);
  getObjectId(tagged);
  return (
    <p>
      {listOwnKeys(tagged).join(",")}|{Object.keys(taggedList).join(",")}|
      {Object.getOwnPropertyNames(tagged).join(",")}|
      {Object.getOwnPropertyNames(taggedList).join(",")}|{String(tagged.hasOwnProperty("__id"))}|
      {String(getObjectId(taggedList) === 2)}|
      {String(Object.getOwnPropertyDescriptor(tagged, "__id")?.enumerable)}
    </p>
  );
};

const Traversal = () => {
  const out: string[] = [];
  visit(grammar, {}, out);
  return <p>{out.join(" ")}</p>;
};

const IndexedWrites = () => {
  const copied: string[] = [];
  ["x", "y"].forEach((item, index) => {
    copied[index] = item;
  });
  const doubled: number[] = [];
  for (let index = 0; index < 3; index++) doubled[index] = index * 2;
  return (
    <p>
      {copied.join(",")}|{doubled.join(",")}|{getTypeName(copied)}:{getTypeName(grammar)}:
      {getTypeName(/re/)}
    </p>
  );
};

const RegExpFlags = () => {
  const pattern = /token/gim;
  const callable: unknown = getTypeName;
  return (
    <p>
      {String(pattern.global)}
      {String(pattern.ignoreCase)}
      {String(pattern.multiline)}
      {String(pattern.sticky)}|{pattern.toString()}|{String(callable === grammar)}|
      {String(callable === pattern)}
    </p>
  );
};

export default function PropertyEnumerability() {
  return (
    <div>
      <TaggedKeys />
      <Traversal />
      <IndexedWrites />
      <RegExpFlags />
    </div>
  );
}

export const isExact = true;
