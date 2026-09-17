export default () => {
  const target = Math.random() > 0.5 ? { value: "old" } : null;
  let trace = "";
  const getKey = () => {
    trace += "K";
    return "value";
  };
  let label = "returned";
  try {
    delete target![getKey()];
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
