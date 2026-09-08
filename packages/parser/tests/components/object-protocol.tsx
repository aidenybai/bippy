const hasObjectPrototype = (value: unknown): boolean =>
  Object.prototype.toString.call(value) === "[object Object]";

const isPlainObject = (value: unknown): boolean => {
  if (!hasObjectPrototype(value)) return false;
  const constructor = (value as { constructor?: unknown }).constructor;
  if (typeof constructor === "undefined") return true;
  const prototype = (constructor as { prototype?: unknown }).prototype;
  if (!hasObjectPrototype(prototype)) return false;
  if (!Object.prototype.hasOwnProperty.call(prototype, "isPrototypeOf")) return false;
  return true;
};

class Route {
  path = "/";
}

const tagged = [
  {},
  [],
  "text",
  7,
  true,
  null,
  undefined,
  new Map(),
  new Set(),
  new Date(0),
  /pattern/,
  () => null,
  new URL("http://example.com/"),
  new URLSearchParams("a=1"),
  new Error("boom"),
  Symbol.iterator,
  new Uint16Array(2),
  Object.create(null),
];

const plainness = [{}, Object.create(null), new Route(), [], new Map(), "text"].map((value) =>
  isPlainObject(value) ? "plain" : "other",
);

const bareParams: Record<string, string> = Object.create(null);
bareParams.postId = "42";
const bareKeys = Object.keys(bareParams).join(",");
const hasHasOwn = typeof bareParams.hasOwnProperty;
const hasConstructor = typeof bareParams.constructor;

const iteratorKey = Symbol.for("iterator-key");
const symbolled = { visible: 1, [iteratorKey]: "hidden" };
const spreadSymbolled = { ...symbolled };
const ownSymbols = Object.getOwnPropertySymbols(spreadSymbolled).map((symbol) => symbol.toString());
const hasSymbol = Object.prototype.hasOwnProperty.call(spreadSymbolled, iteratorKey);

const helper = function helper(input: string) {
  return input;
};
Object.defineProperty(helper, "__esModule", { value: true });
const functionNames = Object.getOwnPropertyNames(helper).join(",");
const isNameEnumerable = Object.getOwnPropertyDescriptor(helper, "name")?.enumerable;
const interop = Object.create(Object.getPrototypeOf(helper));
Object.defineProperties(
  interop,
  Object.getOwnPropertyDescriptors({ default: helper, kind: "esm" }),
);
const interopText = `${interop.default("call")}/${Object.keys(interop).join(",")}`;
const boxedKeys = Object.keys(Object({ boxed: true })).join(",");

const buffer = new Uint16Array(3);
buffer[1] = 5;
const bufferText = Array.from(buffer).join("-");

history.replaceState({ page: 2 }, "");
const historyPage = (history.state as { page: number }).page;

export default function ObjectProtocol() {
  return (
    <dl>
      <dt>tags</dt>
      <dd>{tagged.map((value) => Object.prototype.toString.call(value)).join(" ")}</dd>
      <dt>plainness</dt>
      <dd>{plainness.join(" ")}</dd>
      <dt>null prototype</dt>
      <dd>
        {bareKeys}/{hasHasOwn}/{hasConstructor}
      </dd>
      <dt>symbols</dt>
      <dd>
        {ownSymbols.join(",")}/{String(hasSymbol)}/{Object.keys(spreadSymbolled).join(",")}
      </dd>
      <dt>function shape</dt>
      <dd>
        {functionNames}/{String(isNameEnumerable)}/{interopText}/{boxedKeys}
      </dd>
      <dt>typed array</dt>
      <dd>{bufferText}</dd>
      <dt>history</dt>
      <dd>{historyPage}</dd>
    </dl>
  );
}
