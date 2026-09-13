export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let label = "returned";
  const consume = (value: string) => value;
  const getCallee = () => {
    calls++;
    if (shouldThrow) throw new Error("callee");
    return consume;
  };
  const getValue = () => {
    calls++;
    return "value";
  };
  try {
    getCallee()(getValue());
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${calls}`}
    </main>
  );
};
