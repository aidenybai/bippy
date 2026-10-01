export default () => {
  const values = [1, 2];
  let calls = 0;
  const found = values.find((value, index) => {
    calls++;
    if (index === 0) values.push(3);
    return value === 3;
  });
  const shrinking = [1, 2, 3];
  let missing = 0;
  shrinking.find((value, index) => {
    if (index === 0) shrinking.length = 1;
    if (value === undefined) missing++;
    return false;
  });
  return (
    <main>
      <span>Search:</span>
      {`${found === undefined ? "missing" : found}:${calls}:${missing}`}
    </main>
  );
};
