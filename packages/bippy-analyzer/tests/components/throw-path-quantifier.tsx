export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let label = "returned";
  try {
    [1, 2].every(() => {
      calls++;
      if (shouldThrow) throw new Error("predicate failed");
      return true;
    });
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
