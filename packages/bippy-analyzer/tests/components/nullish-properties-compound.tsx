export default () => {
  const target = undefined;
  let trace = "";
  const getKey = () => {
    trace += "K";
    return "value";
  };
  const getValue = () => {
    trace += "R";
    return 1;
  };
  let label = "returned";
  try {
    target![getKey()] += getValue();
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
