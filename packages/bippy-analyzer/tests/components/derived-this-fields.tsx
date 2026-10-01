export default () => {
  class Parent {
    value = "old";
    constructor() {
      return { value: "new" };
    }
  }
  class Child extends Parent {
    label = `${this.value}-field`;
    constructor() {
      super();
      this.value += "-body";
    }
  }
  const instance = new Child();
  return (
    <main>
      <span>Result:</span>
      {`${instance.value}:${instance.label}`}
    </main>
  );
};
