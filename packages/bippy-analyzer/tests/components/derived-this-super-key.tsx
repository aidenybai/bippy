export default () => {
  let keys = 0;
  let calls = 0;
  let label = "returned";
  const getKey = (): "getValue" => {
    keys++;
    return "getValue";
  };
  class Parent {
    constructor() {
      calls++;
    }
    getValue() {
      return "parent";
    }
  }
  class Child extends Parent {
    constructor() {
      const value = super[getKey()];
      super();
      label = value();
    }
  }
  try {
    new Child();
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${keys}:${calls}`}
    </main>
  );
};
