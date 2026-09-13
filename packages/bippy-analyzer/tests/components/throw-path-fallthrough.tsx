export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let label = "returned";
  const run = () => {
    calls++;
    if (shouldThrow) throw new Error("failed");
    calls++;
  };
  try {
    run();
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
