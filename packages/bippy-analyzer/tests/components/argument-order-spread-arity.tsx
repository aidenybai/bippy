export default () => {
  const hasValues = Math.random() > 0.5;
  const values = hasValues ? [1, 2] : [];
  let calls = 0;
  const getLast = () => {
    calls++;
    return 3;
  };
  const consume = (...args: number[]) => `${args.length}:${args.join(",")}`;
  const result = consume(...values, getLast());
  return (
    <main>
      <span>Result:</span>
      {`${result}:${calls}`}
    </main>
  );
};
