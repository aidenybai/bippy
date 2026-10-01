export default () => {
  let calls = 0;
  let label = "returned";
  class Parent {
    constructor() {
      calls++;
    }
  }
  class Child extends Parent {
    constructor() {
      super();
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
