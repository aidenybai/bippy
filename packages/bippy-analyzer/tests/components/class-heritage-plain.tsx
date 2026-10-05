export default () => {
  let trace = "";
  const key = () => {
    trace += "K";
    return "method";
  };
  class Child {
    [key()]() {}
    static ready = (trace += "S");
    field = (trace += "I");
  }
  trace += "A";
  new Child();
  return (
    <main>
      <span>Result:</span>
      {trace}
    </main>
  );
};
