export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let label = "returned";
  const run = () => {
    calls++;
    if (shouldThrow) throw new Error("failed");
    return "value";
  };
  try {
    const first = run(),
      second = ++calls;
    if (first !== "value" || second !== 2) label = "invalid";
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
