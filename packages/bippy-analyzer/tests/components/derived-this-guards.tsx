export default () => {
  const useFirst = Math.random() > 0.5;
  class Parent {
    value = "old";
    constructor() {
      return useFirst ? { value: "first" } : { value: "second" };
    }
  }
  class Child extends Parent {
    label = `${this.value}-field`;
  }
  const instance = new Child();
  return (
    <main>
      <span>Result:</span>
      {`${instance.value}:${instance.label}`}
    </main>
  );
};
