export default () => {
  let trace = "";
  let label = "returned";

  try {
    for (let index = ((trace += "I"), 0); (trace += "T"), index < 0; index++, trace += "U") {
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
