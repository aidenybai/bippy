export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let label = "returned";
  try {
    try {
      calls++;
      if (shouldThrow) throw new Error("inner");
      calls++;
    } catch {
      calls += 10;
      throw new Error("outer");
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
