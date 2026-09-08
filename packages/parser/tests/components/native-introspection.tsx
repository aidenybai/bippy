/** Two text children become two HostText fibers, so the comparer checks the computed value. */
const Shown = ({ value }: { value: string }) => (
  <code>
    {"= "}
    {value}
  </code>
);

const functionToString = Function.prototype.toString;
const objectToString = Object.prototype.toString;

/** lodash's `toSource`: the host's source text of a function, `[native code]` for built-ins. */
const toSource = (callable: unknown): string => {
  if (callable === null || callable === undefined) return "";
  try {
    return functionToString.call(callable);
  } catch {
    return String(callable);
  }
};

const isNativeFunction = (value: unknown): boolean =>
  typeof value === "function" && toSource(value).includes("[native code]");

const double = (value: number): number => value * 2;

/** Evaluated functions have bundler-rewritten text, so only its native-ness is decided statically. */
const describeSource = (callable: unknown): string =>
  isNativeFunction(callable) ? "native" : "user";

const Sources = () => (
  <dl>
    <dt>native</dt>
    <dd>
      <Shown
        value={[
          isNativeFunction(Object.defineProperty),
          isNativeFunction(Array.prototype.map),
          isNativeFunction(Math.max),
          isNativeFunction("text"),
          isNativeFunction(null),
        ].join(" ")}
      />
    </dd>
    <dt>source</dt>
    <dd>
      <Shown value={toSource(Object.defineProperty)} />
      <Shown value={toSource(Array.prototype.map)} />
      <Shown value={toSource("text")} />
      <Shown value={toSource(42)} />
      <Shown value={describeSource(Object.keys)} />
    </dd>
    <dt>length</dt>
    <dd>
      <Shown
        value={[
          Math.max.length,
          Object.defineProperty.length,
          Array.prototype.map.length,
          Object.keys.name,
          double.length,
        ].join(" ")}
      />
    </dd>
  </dl>
);

const Typeofs = () => (
  <ul>
    <li>
      <Shown
        value={[
          typeof Object.defineProperty,
          typeof Object.create,
          typeof Math.max,
          typeof Math.PI,
          typeof JSON.parse,
          typeof Symbol.iterator,
          typeof Date.now(),
          typeof Math.random(),
          typeof performance.now(),
        ].join(" ")}
      />
    </li>
    <li>
      <Shown
        value={[Math, JSON, Object.defineProperty, Object.prototype, Array.prototype, Math.max]
          .map((value) => objectToString.call(value))
          .join(" ")}
      />
    </li>
  </ul>
);

/** `Object(value)` on the operands lodash's `_root` and `baseIsNative` box. */
const Boxing = () => {
  const plain = { kind: "plain" };
  const list = [1, 2];
  const boxedNull = Object(null);
  const boxedUndefined = Object(undefined);
  return (
    <p>
      <Shown
        value={[
          Object(plain) === plain,
          Object(list) === list,
          Object(double) === double,
          Object.keys(boxedNull).length,
          Object.keys(boxedUndefined).length,
          boxedNull instanceof Object,
        ].join(" ")}
      />
    </p>
  );
};

export default function NativeIntrospection() {
  return (
    <main>
      <Sources />
      <Typeofs />
      <Boxing />
    </main>
  );
}
