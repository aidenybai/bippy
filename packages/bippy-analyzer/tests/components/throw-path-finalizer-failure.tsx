export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let label = "returned";
  const fail = () => {
    throw new Error("finalizer");
  };
  const run = () => {
    try {
      calls++;
      return "returned";
    } finally {
      if (shouldThrow) {
        calls++;
        fail();
      }
    }
  };
  try {
    label = run();
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
