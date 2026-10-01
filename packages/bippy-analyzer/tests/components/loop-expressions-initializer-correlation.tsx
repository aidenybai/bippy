export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  const initialize = () => {
    trace += "I";
    if (shouldThrow) throw undefined;
    return 0;
  };
  try {
    for (let index = initialize(); index < 1; index++) {
      trace += "B";
    }
    trace += "L";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${shouldThrow ? "yes" : "no"}:${label}:${trace}`}
    </main>
  );
};
