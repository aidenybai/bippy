export default () => {
  let trace = "";
  let captured;
  let label = "returned";
  const initialize = () => {
    trace += "F";
    if (Math.random() > 0.5) throw "field";
    return "ready";
  };
  try {
    class Holder {
      static captured = (captured = this);
      static value = initialize();
      static later = (trace += "L");
      static method() {}
    }
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}:${captured.hasOwnProperty("value")}:${captured.hasOwnProperty("later")}:${typeof captured.method}`}
    </main>
  );
};
