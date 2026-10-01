export default () => {
  const isFirst = Math.random() > 0.5;
  let calls = 0;
  const index = [0, 1].findIndex((value) => {
    calls++;
    return value === 0 ? isFirst : true;
  });
  return (
    <main>
      <span>Search:</span>
      {`${isFirst ? "first" : "later"}:${index}:${calls}`}
    </main>
  );
};
