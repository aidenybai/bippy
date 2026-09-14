export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let label = "returned";
  const getValue = () => {
    if (shouldThrow) throw new Error("argument");
    return "value";
  };
  const consume = (value: string) => {
    calls++;
    return value;
  };
  try {
    consume(getValue());
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
