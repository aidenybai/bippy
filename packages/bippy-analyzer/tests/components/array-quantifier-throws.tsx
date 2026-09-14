export default () => {
  let someCalls = 0;
  let everyCalls = 0;
  let result = "";
  try {
    [1, 2].some(() => {
      someCalls++;
      throw new Error("some failed");
    });
  } catch {
    result += "some";
  }
  try {
    [1, 2].every(() => {
      everyCalls++;
      throw new Error("every failed");
    });
  } catch {
    result += "every";
  }
  return (
    <main>
      <span>Calls:</span>
      {`${result}:${someCalls}:${everyCalls}`}
    </main>
  );
};
