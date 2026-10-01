export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let bodies = 0;
  let label = "returned";
  const getFirst = () => {
    calls++;
    if (shouldThrow) throw new Error("first");
    return "first";
  };
  const getSecond = () => {
    calls++;
    return "second";
  };
  class Parent {
    value: string;
    constructor(first: string, second: string) {
      bodies++;
      this.value = first + second;
    }
  }
  class Child extends Parent {
    constructor() {
      super(getFirst(), getSecond());
      bodies += 10;
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
      {`${label}:${calls}:${bodies}`}
    </main>
  );
};
