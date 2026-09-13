export default () => {
  const someValues = [undefined, 1];
  const everyValues = [undefined, 1];
  let someCalls = 0;
  let everyCalls = 0;
  const some = someValues.some((value) => {
    someCalls++;
    if (value === undefined) someValues.push(9);
    return value === 9;
  });
  const every = everyValues.every((value) => {
    everyCalls++;
    if (value === undefined) everyValues.push(9);
    return value !== 9;
  });
  return (
    <main>
      <span>Length:</span>
      {`${some}:${someCalls}:${someValues.length}|${every}:${everyCalls}:${everyValues.length}`}
    </main>
  );
};
