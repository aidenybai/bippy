export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  const items = () => {
    trace += "R";
    if (shouldThrow) throw "source";
    return { first: 1, second: 2 };
  };
  try {
    for (const key in items()) {
      trace += key;
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
