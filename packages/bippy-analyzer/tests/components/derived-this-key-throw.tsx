export default () => {
  const shouldThrow = Math.random() > 0.5;
  let keys = 0;
  let calls = 0;
  let observed = "unset";
  const getKey = (): "value" => {
    keys++;
    if (shouldThrow) throw new Error("key");
    return "value";
  };
  class Parent {
    value = "old";
    constructor() {
      return { value: "new" };
    }
  }
  class Child extends Parent {
    constructor() {
      super();
      try {
        observed = this[getKey()];
        calls++;
      } catch {
        observed = "caught";
      }
    }
  }
  new Child();
  return (
    <main>
      <span>Result:</span>
      {`${observed}:${keys}:${calls}`}
    </main>
  );
};
