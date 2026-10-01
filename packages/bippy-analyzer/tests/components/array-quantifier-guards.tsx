export default () => {
  const isFirst = Math.random() > 0.5;
  let someCalls = 0;
  let everyCalls = 0;
  const some = [0, 1].some((value) => {
    someCalls++;
    return value === 0 ? isFirst : true;
  });
  const every = [0, 1].every((value) => {
    everyCalls++;
    return value === 0 ? isFirst : false;
  });
  return (
    <main>
      <span>Calls:</span>
      {`${isFirst ? "first" : "later"}:${some}:${someCalls}:${every}:${everyCalls}`}
    </main>
  );
};
