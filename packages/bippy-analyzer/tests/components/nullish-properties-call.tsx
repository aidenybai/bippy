export default () => {
  const target = null;
  let trace = "";
  const getKey = () => {
    trace += "K";
    return String(Math.random());
  };
  const getValue = () => {
    trace += "A";
    return 1;
  };
  let label = "returned";
  try {
    target![getKey()](getValue());
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
