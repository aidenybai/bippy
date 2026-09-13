export default () => {
  const shouldThrow = Math.random() > 0.5;
  let value = "";
  let label = "returned";
  let calls = 0;
  const getNext = () => {
    calls++;
    if (shouldThrow) throw new Error("failed");
    return "new";
  };
  try {
    value ||= getNext();
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${value}:${calls}`}
    </main>
  );
};
