export default () => {
  const evaluate = () => {
    class Holder {
      static value = "old";
    }
    if (Math.random() > 0.5) Holder.value = "new";
    return `${Holder.value}:${Holder.hasOwnProperty("value")}`;
  };
  return (
    <main>
      <span>Result:</span>
      {evaluate()}
    </main>
  );
};
