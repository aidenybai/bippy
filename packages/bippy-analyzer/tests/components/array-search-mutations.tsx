export default () => {
  const values = [1, 2, 3];
  const visited: number[] = [];
  const result = values.find((value, index) => {
    visited.push(value);
    if (index === 0) {
      values[1] = 9;
      values.push(4);
    }
    return value === 9;
  });
  return (
    <main>
      <span>Search:</span>
      {`${result}:${visited.join(",")}:${values.join(",")}`}
    </main>
  );
};
