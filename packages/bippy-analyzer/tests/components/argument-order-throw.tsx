export default () => {
  let calls = 0;
  let bodies = 0;
  let label = "returned";
  const getFirst = () => {
    calls++;
    throw new Error("first");
  };
  const getSecond = () => {
    calls++;
    return "second";
  };
  const consume = (first: string, second: string) => {
    bodies++;
    return first + second;
  };
  try {
    consume(getFirst(), getSecond());
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${calls}:${bodies}`}
    </main>
  );
};
