export default () => {
  const shouldThrow = Math.random() > 0.5;
  let previous: object | null = null;
  let calls = 0;
  class Parent {
    constructor() {
      calls++;
      if (calls === 1) {
        previous = this;
        if (shouldThrow) throw new Error("retry");
      }
    }
  }
  class Child extends Parent {
    constructor() {
      try {
        super();
      } catch {
        super();
      }
    }
  }
  const instance = new Child();
  return (
    <main>
      <span>Result:</span>
      {`${previous === instance}:${calls}`}
    </main>
  );
};
