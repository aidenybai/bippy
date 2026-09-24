export default () => {
  const visited: number[] = [];
  let message = "not thrown";
  try {
    [1, 2, 3].find((value) => {
      visited.push(value);
      throw new Error("search failed");
    });
  } catch (error) {
    message = error instanceof Error ? error.message : "unknown error";
  }
  return (
    <main>
      <span>Search:</span>
      {`${message}:${visited.join(",")}`}
    </main>
  );
};
