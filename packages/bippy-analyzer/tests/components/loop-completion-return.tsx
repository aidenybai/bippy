export default () => {
  let trace = "";
  const shouldReturn = Math.random() > 0.5;
  const run = () => {
    for (let index = 0; index < 3; index++) {
      trace += index;
      if (index === 1 && shouldReturn) return "early";
    }
    return "late";
  };
  const label = run();
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
