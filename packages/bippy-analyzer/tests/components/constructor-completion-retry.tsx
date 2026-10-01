export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let bodies = 0;
  class Parent {
    constructor() {
      calls++;
      if (calls === 1 && shouldThrow) throw new Error("parent");
    }
  }
  class Child extends Parent {
    constructor() {
      try {
        super();
      } catch {
        super();
      }
      bodies++;
    }
  }
  new Child();
  return (
    <main>
      <span>Result:</span>
      {`${calls}:${bodies}`}
    </main>
  );
};
