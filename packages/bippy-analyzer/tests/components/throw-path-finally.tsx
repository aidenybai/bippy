export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let label = "returned";
  try {
    calls++;
    if (shouldThrow) throw new Error("failed");
    calls++;
  } catch {
    label = "caught";
  } finally {
    calls += 10;
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${calls}`}
    </main>
  );
};
