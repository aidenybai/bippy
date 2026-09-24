export default () => {
  const shouldKeep = Math.random() > 0.5;
  let calls = 0;
  let value = shouldKeep ? "old" : "";
  const getNext = () => {
    calls++;
    return "new";
  };
  value ||= getNext();
  return (
    <main>
      <span>Result:</span>
      {`${shouldKeep ? "kept" : "set"}:${value}:${calls}`}
    </main>
  );
};
