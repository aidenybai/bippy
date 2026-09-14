export default () => {
  let calls = 0;
  const target =
    Math.random() > 0.5
      ? {
          get value() {
            calls++;
            return "ready";
          },
        }
      : null;
  let label = "returned";
  try {
    const value = target!.value;
    label = value;
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
