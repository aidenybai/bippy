export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  const items = () => {
    trace += "R";
    if (shouldThrow) throw "source";
    return [1, 2];
  };
  try {
    for (const item of items()) {
      trace += item;
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
