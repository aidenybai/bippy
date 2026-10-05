export default () => {
  let trace = "";
  const first = () => {
    trace += "F";
    throw "field";
  };
  let label = "returned";
  try {
    class Child {
      static first = first();
      static later = (trace += "L");
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
