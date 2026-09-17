export default () => {
  let trace = "";
  const target = {
    get value() {
      trace += "G";
      return "old";
    },
  };
  const key = () => {
    trace += "K";
    return "value";
  };
  const value = () => {
    trace += "R";
    return "new";
  };
  let label = "returned";
  try {
    target[key()] = value();
    trace += "A";
  } catch (error) {
    label = error instanceof TypeError ? "caught" : "other";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
