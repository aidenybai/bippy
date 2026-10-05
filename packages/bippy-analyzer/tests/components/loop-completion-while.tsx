export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  try {
    let index = 0;
    while (index < 3) {
      trace += index;
      if (index === 1 && shouldThrow) throw "block";
      index++;
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
