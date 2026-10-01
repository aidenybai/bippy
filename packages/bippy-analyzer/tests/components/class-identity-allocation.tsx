export default () => {
  let previous: object | null = null;
  let calls = 0;
  let observed = "unset";
  class Parent {
    constructor() {
      calls++;
      if (calls === 1) {
        previous = this;
        throw new Error("retry");
      }
      observed = String(this === previous);
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
  new Child();
  return (
    <main>
      <span>Result:</span>
      {`${observed}:${calls}`}
    </main>
  );
};
