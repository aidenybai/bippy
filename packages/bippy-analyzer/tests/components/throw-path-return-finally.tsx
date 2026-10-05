export default () => {
  const shouldReturn = Math.random() > 0.5;
  let calls = 0;
  const run = () => {
    try {
      calls++;
      if (shouldReturn) return "early";
      calls++;
    } finally {
      calls += 10;
    }
    return "late";
  };
  const label = run();
  return (
    <main>
      <span>Result:</span>
      {`${label}:${calls}`}
    </main>
  );
};
