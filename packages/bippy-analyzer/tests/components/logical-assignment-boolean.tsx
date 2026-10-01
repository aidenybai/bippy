export default () => {
  let value = Math.random() > 0.5;
  let calls = 0;
  const getNext = () => {
    calls++;
    return true;
  };
  value ||= getNext();
  return (
    <main>
      <span>Result:</span>
      {`${value ? "ready" : "empty"}:${calls}`}
    </main>
  );
};
