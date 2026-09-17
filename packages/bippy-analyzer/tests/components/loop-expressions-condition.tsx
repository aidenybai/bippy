export default () => {
  let trace = "";
  let label = "returned";
  try {
    for (
      let index = 0;
      (() => {
        trace += "T";
        throw "test";
      })();
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
