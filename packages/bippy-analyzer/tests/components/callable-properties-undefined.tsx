export default () => {
  const evaluate = () => {
    class Holder {}
    if (Math.random() > 0.5) Holder.value = undefined;
    return `${typeof Holder.value}:${Holder.hasOwnProperty("value")}`;
  };
  return (
    <main>
      <span>Result:</span>
      {evaluate()}
    </main>
  );
};
