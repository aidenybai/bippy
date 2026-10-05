export default () => {
  const evaluate = () => {
    class Base {
      static value = "base";
    }
    class Holder extends Base {
      static value = "own";
    }
    if (Math.random() > 0.5) delete Holder.value;
    return `${Holder.value}:${Holder.hasOwnProperty("value")}`;
  };
  return (
    <main>
      <span>Result:</span>
      {evaluate()}
    </main>
  );
};
