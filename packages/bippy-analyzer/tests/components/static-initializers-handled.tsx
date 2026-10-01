export default () => {
  let trace = "";
  const initialize = () => {
    try {
      throw "handled";
    } catch {
      trace += "C";
      return "ready";
    }
  };
  class Holder {
    static value = initialize();
    static {
      trace += "B";
    }
  }
  return (
    <main>
      <span>Result:</span>
      {`${Holder.value}:${trace}`}
    </main>
  );
};
