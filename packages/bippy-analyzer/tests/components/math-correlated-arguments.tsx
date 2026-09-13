export default () => {
  const isFirst = Math.random() > 0.5;
  const left = isFirst ? -4 : 2;
  const right = isFirst ? -8 : 6;
  const value = Math.max(left, right);
  return (
    <main>
      <span>Maximum:</span>
      {value}
    </main>
  );
};
