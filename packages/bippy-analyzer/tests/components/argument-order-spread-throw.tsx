export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let label = "none";
  const getValues = () => {
    calls++;
    if (shouldThrow) throw new Error("spread");
    return [1, 2];
  };
  const getLast = () => {
    calls++;
    return 3;
  };
  const consume = (...values: number[]) => values.join(",");
  try {
    label = consume(...getValues(), getLast());
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
