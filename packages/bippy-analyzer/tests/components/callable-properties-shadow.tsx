export default () => {
  const evaluate = () => {
    class Base {
      static value = "base";
    }
    class Holder extends Base {}
    if (Math.random() > 0.5) Holder.value = undefined;
    return `${Holder.value}:${Holder.hasOwnProperty("value")}`;
  };
  return (
    <main>
      <span>Result:</span>
      {evaluate()}
    </main>
  );
};
