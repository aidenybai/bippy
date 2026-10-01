export default () => {
  let trace = "";
  let label = "returned";
  try {
    for (
      let index = 0;
      index < 2;
      index++,
        (() => {
          trace += "U";
          throw "update";
        })()
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
