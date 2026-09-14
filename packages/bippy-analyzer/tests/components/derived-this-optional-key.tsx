export default () => {
  const isPresent = Math.random() > 0.5;
  let keys = 0;
  let observed = "unset";
  const getKey = (): "value" => {
    keys++;
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
      const receiver = isPresent ? this : null;
      observed = receiver?.[getKey()] ?? "none";
    }
  }
  new Child();
  return (
    <main>
      <span>Result:</span>
      {`${observed}:${keys}`}
    </main>
  );
};
