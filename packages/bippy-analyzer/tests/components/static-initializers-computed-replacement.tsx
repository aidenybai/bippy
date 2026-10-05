export default () => {
  let trace = "";
  let captured;
  let label = "returned";
  const initialize = () => {
    trace += "K";
    throw "field";
  };
  try {
    class Holder {
      static captured = (captured = this);
      static value() {}
      static ["val" + "ue"] = initialize();
    }
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${typeof captured.value}:${trace}`}
    </main>
  );
};
