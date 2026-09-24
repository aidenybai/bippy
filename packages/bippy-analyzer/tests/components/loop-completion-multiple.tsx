export default () => {
  let trace = "";
  let label = "returned";
  const first = Math.random() > 0.5;
  const second = Math.random() > 0.5;
  try {
    for (let index = 0; index < 3; index++) {
      trace += index;
      if (index === 0 && first) throw "first";
      if (index === 1 && second) throw "second";
    }
    trace += "L";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
