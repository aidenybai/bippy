export default () => {
  let trace = "";
  let label = "returned";
  try {
    for (
      let index = (() => {
        trace += "I";
        throw null;
      })();
      index < 2;
      index++
    ) {
      trace += "B";
    }
    trace += "L";
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
