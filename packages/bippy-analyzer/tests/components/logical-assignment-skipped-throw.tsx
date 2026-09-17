export default () => {
  const shouldKeep = Math.random() > 0.5;
  let calls = 0;
  let value = shouldKeep ? "old" : "";
  let label = "kept";
  const getNext = () => {
    calls++;
    throw new Error("failed");
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
