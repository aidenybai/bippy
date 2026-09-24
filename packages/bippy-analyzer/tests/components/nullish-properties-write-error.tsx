export default () => {
  const target = null;
  let trace = "";
  const getKey = () => {
    trace += "K";
    return "value";
  };
  const getValue = () => {
    trace += "R";
    throw new Error("rhs");
  };
  let label = "returned";
  try {
    target![getKey()] = getValue();
  } catch (error) {
    label = error.message;
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
