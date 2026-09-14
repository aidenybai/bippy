export default () => {
  let label = "returned";
  let read = () => ({ value: "unset" });
  class Parent {
    value = "old";
    constructor() {
      return { value: "new" };
    }
  }
  class Child extends Parent {
    constructor() {
      const getThis = () => this;
      try {
        getThis();
      } catch {
        label = "caught";
      }
      super();
      read = getThis;
    }
  }
  const instance = new Child();
  const observed = read.call({ value: "other" });
  return (
    <main>
      <span>Result:</span>
      {`${label}:${observed === instance}:${observed.value}`}
    </main>
  );
};
