export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  try {
    class Holder {
      static {
        for (let index = 0; index < 3; index++) {
          trace += index;
          if (index === 1 && shouldThrow) throw "block";
        }
      }
      static later = (trace += "L");
    }
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
