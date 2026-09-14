export default () => {
  let calls = 0;
  let label = "returned";
  class Parent {
    value = "old";
    constructor() {
      calls++;
    }
  }
  class Child extends Parent {
    constructor() {
      this.value = "early";
      super();
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
      {`${label}:${calls}`}
    </main>
  );
};
