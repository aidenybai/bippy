export default () => {
  const someValues = [1, 2, 3];
  const everyValues = [1, 2, 3];
  let someCalls = 0;
  let everyCalls = 0;
  const some = someValues.some(() => {
    someCalls++;
    someValues.length = 1;
    return false;
  });
  const every = everyValues.every(() => {
    everyCalls++;
    everyValues.length = 1;
    return true;
  });
  return (
    <main>
      <span>Calls:</span>
      {`${some}:${someCalls}|${every}:${everyCalls}`}
    </main>
  );
};
