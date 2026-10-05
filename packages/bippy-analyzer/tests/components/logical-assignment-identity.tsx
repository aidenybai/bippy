export default () => {
  const shouldKeep = Math.random() > 0.5;
  const original = { label: "old" };
  let value = shouldKeep ? original : null;
  let calls = 0;
  const getNext = () => {
    calls++;
    return { label: "new" };
  };
  value ??= getNext();
  return (
    <main>
      <span>Result:</span>
      {`${value === original ? "same" : "new"}:${calls}`}
    </main>
  );
};
