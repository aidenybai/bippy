export default () => {
  let trace = "";
  const key = () => {
    trace += "K";
    return "value";
  };
  class Holder {
    [key()] = (trace += "I");
  }
  return (
    <main>
      <span>Result:</span>
      {trace}
    </main>
  );
};
