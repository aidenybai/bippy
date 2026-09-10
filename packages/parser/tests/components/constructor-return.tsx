class ReturnsMap {
  readonly own = "instance";
  constructor() {
    return new Map([["kind", "map"]]);
  }
}

class ReturnsFunction {
  readonly own = "instance";
  constructor() {
    return () => "callable";
  }
}

class ReturnsPrimitive {
  readonly own = "instance";
  constructor() {
    return "ignored";
  }
}

class ReturnsProxy {
  readonly own = "instance";
  constructor() {
    return new Proxy({ kind: "proxy" }, {});
  }
}

const describe = (value: unknown): string => {
  if (value instanceof Map) return `map:${value.get("kind")}`;
  if (typeof value === "function") return `function:${value()}`;
  if (value instanceof ReturnsPrimitive) return `instance:${value.own}`;
  if (typeof value === "object" && value !== null && "kind" in value) return `object:${value.kind}`;
  return "other";
};

const ConstructorReturn = () => (
  <ul>
    <li>{describe(new ReturnsMap())}</li>
    <li>{describe(new ReturnsFunction())}</li>
    <li>{describe(new ReturnsPrimitive())}</li>
    <li>{describe(new ReturnsProxy())}</li>
  </ul>
);

export default ConstructorReturn;
