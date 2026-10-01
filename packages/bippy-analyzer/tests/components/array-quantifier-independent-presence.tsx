export default () => {
  const hasFirst = Math.random() > 0.5;
  const hasSecond = Math.random() > 0.5;
  const values = [0, 1];
  let calls = 0;
  values.some((_value, index) => {
    calls++;
    if (index === 0) {
      values.length = 0;
      if (hasFirst) values.push(0);
      if (hasSecond) values.push(0);
    }
    return false;
  });
  return (
    <main>
      <span>Presence:</span>
      {`${hasFirst ? "first" : "none"}:${hasSecond ? "second" : "none"}:${calls}`}
    </main>
  );
};
