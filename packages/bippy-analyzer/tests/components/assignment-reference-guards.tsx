export default () => {
  const shouldUseFirst = Math.random() > 0.5;
  const first = { first: 0, second: 0 };
  const second = { first: 0, second: 0 };
  const receiver = shouldUseFirst ? first : second;
  const key = shouldUseFirst ? "first" : "second";
  receiver[key] = 2;
  return (
    <main>
      <span>Result:</span>
      {`${first.first}:${first.second}:${second.first}:${second.second}`}
    </main>
  );
};
