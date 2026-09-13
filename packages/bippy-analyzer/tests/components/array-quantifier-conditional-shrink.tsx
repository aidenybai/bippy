export default () => {
  const shouldShrink = Math.random() > 0.5;
  const values = [1, 2, 3];
  let calls = 0;
  const result = values.some((_value, index) => {
    calls++;
    if (index === 0 && shouldShrink) values.length = 1;
    return false;
  });
  return (
    <main>
      <span>Calls:</span>
      {`${shouldShrink ? "short" : "full"}:${result}:${calls}`}
    </main>
  );
};
