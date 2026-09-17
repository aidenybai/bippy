export default () => {
  let trace = "";
  const first = () => {
    trace += "K";
    throw "key";
  };
  const later = () => {
    trace += "L";
    return "later";
  };
  let label = "returned";
  try {
    class Holder {
      set [first()](value) {}
      [later()]() {}
      static {
        trace += "S";
      }
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
