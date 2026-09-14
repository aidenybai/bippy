export default () => {
  class Child extends null {
    static label = "ready";
  }
  return (
    <main>
      <span>Result:</span>
      {Child.label}
    </main>
  );
};
