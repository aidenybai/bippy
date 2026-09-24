export default () => {
  let observed = "unset";
  class Parent {
    value = "old";
    constructor() {
      return { value: "new" };
    }
    getValue() {
      return this === undefined ? "unbound" : this.value;
    }
  }
  class Child extends Parent {
    constructor() {
      super();
      const getValue = super.getValue;
      observed = getValue();
    }
  }
  new Child();
  return (
    <main>
      <span>Result:</span>
      {observed}
    </main>
  );
};
