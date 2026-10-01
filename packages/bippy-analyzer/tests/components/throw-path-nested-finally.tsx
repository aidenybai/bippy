export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let label = "returned";
  try {
    try {
      calls++;
      if (shouldThrow) throw new Error("failed");
      calls++;
    } finally {
      calls += 10;
    }
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
