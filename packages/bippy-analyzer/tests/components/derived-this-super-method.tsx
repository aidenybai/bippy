export default () => {
  let observed = "unset";
  class Parent {
    value = "old";
    constructor() {
      return { value: "new" };
    }
    getValue() {
      return this.value;
    }
  }
  class Child extends Parent {
    constructor() {
      super();
      observed = super.getValue();
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
