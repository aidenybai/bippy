export default () => {
  const target = Math.random() > 0.5 ? { value: "old" } : null;
  let calls = 0;
  let label = "returned";
  const getNext = () => {
    calls++;
    return "new";
  };
  try {
    target!.value = getNext();
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
