import * as namespace from "./modules/conflict";

export default () => (
  <main>
    <span>Result:</span>
    {[
      Object.hasOwn(namespace, Symbol.toStringTag),
      Object.prototype.hasOwnProperty.call(namespace, Symbol.toStringTag),
      Object.prototype.propertyIsEnumerable.call(namespace, Symbol.toStringTag),
      Object.hasOwn(namespace, Symbol.iterator),
      Object.hasOwn(namespace, Symbol.for("Symbol.toStringTag")),
      Object.hasOwn(namespace, Symbol("Symbol.toStringTag")),
    ]
      .map((isPresent) => (isPresent ? "yes" : "no"))
      .join(":")}
  </main>
);
