export default () => {
  class Parent {
    constructor() {
      return Math.random();
    }
  }
  let label = "returned";
  try {
    new Parent();
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
