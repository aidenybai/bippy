export default () => {
  let trace = "";
  class Holder {
    static first = (trace += "F");
    static {
      trace += "B";
    }
    static value = this.method();
    static method() {
      trace += "M";
      return "ready";
    }
    field = (trace += "I");
  }
  return (
    <main>
      <span>Result:</span>
      {`${trace}:${Holder.value}`}
    </main>
  );
};
