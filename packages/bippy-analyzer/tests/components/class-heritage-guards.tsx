export default () => {
  let trace = "";
  const parent = () => {
    trace += "H";
    if (Math.random() > 0.5) throw "parent";
    return class {};
  };
  const key = () => {
    trace += "K";
    return "method";
  };
  let label = "returned";
  try {
    class Child extends parent() {
      [key()]() {}
      static ready = (trace += "S");
    }
    trace += "A";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
