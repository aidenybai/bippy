export default () => {
  class Parent {
    value = "old";
    constructor() {
      return { value: "new" };
    }
  }
  class Child extends Parent {}
  const instance = new Child();
  return (
    <main>
      <span>Result:</span>
      {instance.value}
    </main>
  );
};
