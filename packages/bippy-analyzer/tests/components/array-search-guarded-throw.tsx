export default () => {
  const shouldThrow = Math.random() > 0.5;
  let calls = 0;
  let result = "missing";
  try {
    const found = [1, 2].find((value) => {
      calls++;
      if (shouldThrow) throw new Error("search failed");
      return value === 1;
    });
    result = String(found);
  } catch {
    result = "caught";
  }
  return (
    <main>
      <span>Search:</span>
      {`${result}:${calls}`}
    </main>
  );
};
