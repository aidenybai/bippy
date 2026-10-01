export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let bodies = 0;
  let label = "returned";
  const getFirst = () => {
    calls++;
    if (shouldThrow) throw "first";
    return "first";
  };
  const getSecond = () => {
    calls++;
    throw "second";
  };
  const consume = (first: string, second: string) => {
    bodies++;
    return first + second;
  };
  try {
    consume(getFirst(), getSecond());
  } catch (error) {
    label = String(error);
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${calls}:${bodies}`}
    </main>
  );
};
