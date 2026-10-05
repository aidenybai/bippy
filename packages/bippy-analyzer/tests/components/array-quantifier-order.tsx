export default () => {
  let someCalls = 0;
  let everyCalls = 0;
  const some = [1, 2, 3].some((value) => {
    someCalls++;
    return value === 1;
  });
  const every = [1, 2, 3].every((value) => {
    everyCalls++;
    return value < 1;
  });
  return (
    <main>
      <span>Calls:</span>
      {`${some}:${someCalls}|${every}:${everyCalls}`}
    </main>
  );
};
