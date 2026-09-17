export default () => {
  let observed = "unset";
  class Parent {
    value = "old";
    constructor() {
      return { value: "new" };
    }
  }
  class Child extends Parent {
    constructor() {
      const getValue = function (this: { value: string }) {
        return this.value;
      };
      super();
      observed = getValue.call({ value: "other" });
    }
  }
  const instance = new Child();
  return (
    <main>
      <span>Result:</span>
      {`${observed}:${instance.value}`}
    </main>
  );
};
