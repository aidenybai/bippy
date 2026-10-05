export default () => {
  let trace = "";
  const first = () => {
    trace += "K";
    return "value";
  };
  const later = () => {
    trace += "L";
    return "value";
  };
  class Holder {
    static [first()] = ((trace += "1"), "first");
    static [later()] = ((trace += "2"), "second");
  }
  return (
    <main>
      <span>Result:</span>
      {`${trace}:${Holder.value}`}
    </main>
  );
};
