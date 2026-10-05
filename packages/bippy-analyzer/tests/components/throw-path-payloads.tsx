export default () => {
  const mode = Math.floor(Math.random() * 3);
  let calls = 0;
  let label = "returned";
  const run = () => {
    calls++;
    if (mode === 0) throw "first";
    calls++;
    if (mode === 1) throw "second";
    calls++;
    return "done";
  };
  try {
    run();
  } catch (error) {
    label = String(error);
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${calls}`}
    </main>
  );
};
