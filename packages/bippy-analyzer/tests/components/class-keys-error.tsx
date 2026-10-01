export default () => {
  let trace = "";
  const key = () => {
    trace += "K";
    throw "key";
  };
  let label = "returned";
  try {
    class Child {
      [key()]() {}
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
