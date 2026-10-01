export default () => {
  const target = Math.random() > 0.5 ? { value: "ready" } : null;
  let trace = "";
  const getKey = () => {
    trace += "K";
    return "value";
  };
  let label = "returned";
  try {
    const value = target![getKey()];
    label = value;
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
