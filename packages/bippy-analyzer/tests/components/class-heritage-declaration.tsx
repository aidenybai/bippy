export default () => {
  let trace = "";
  const parent = () => {
    trace += "H";
    throw "parent";
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
  } catch (error) {
    label = `caught:${error}`;
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
