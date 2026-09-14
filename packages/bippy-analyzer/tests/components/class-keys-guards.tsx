export default () => {
  let trace = "";
  const first = () => {
    trace += "K";
    if (Math.random() > 0.5) throw "key";
    return "first";
  };
  const later = () => {
    trace += "L";
    return "later";
  };
  let label = "returned";
  try {
    class Holder {
      [first()]() {}
      [later()]() {}
      static ready = (trace += "S");
    }
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
