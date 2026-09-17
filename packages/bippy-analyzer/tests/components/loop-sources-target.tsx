export default () => {
  let trace = "";
  let label = "returned";
  const target = {};
  const key = () => {
    trace += "K";
    return "value";
  };
  const items = () => {
    trace += "R";
    throw "source";
  };
  try {
    for (target[key()] of items()) {
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
