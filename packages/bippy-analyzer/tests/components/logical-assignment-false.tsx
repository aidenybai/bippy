export default () => {
  const shouldKeep = Math.random() > 0.5;
  let value = shouldKeep ? false : undefined;
  let calls = 0;
  const getNext = () => {
    calls++;
    return true;
  };
  value ??= getNext();
  return (
    <main>
      <span>Result:</span>
      {`${value ? "yes" : "no"}:${calls}`}
    </main>
  );
};
