export default () => {
  let trace = "";
  const key = () => {
    trace += "K";
    throw "key";
  };
  let label = "returned";
  try {
    class Holder {
      static first = (trace += "S");
      [key()]() {}
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
