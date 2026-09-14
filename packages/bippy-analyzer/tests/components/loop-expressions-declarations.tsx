export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  const initialize = () => {
    trace += "A";
    if (shouldThrow) throw "first";
    return 0;
  };
  try {
    for (let first = initialize(), index = ((trace += "I"), first); index < 1; index++) {
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
