export default () => {
  const shouldReturnNumber = Math.random() > 0.5;
  class Parent {}
  class Child extends Parent {
    constructor() {
      super();
      if (shouldReturnNumber) return Math.random();
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
