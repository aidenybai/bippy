export default () => {
  let trace = "";
  let label = "returned";
  try {
    class Child {
      static {
        trace += "B";
        throw "block";
      }
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
