export default () => {
  class Parent {}
  class Child extends Parent {
    constructor() {
      super();
      return Math.random();
    }
  }
  let label = "returned";
  try {
    new Child();
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
