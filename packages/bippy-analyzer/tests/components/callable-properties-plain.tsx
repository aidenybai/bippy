export default () => {
  const evaluate = () => {
    class Holder {
      static value = "first";
    }
    const holder = () => {};
    holder.value = "second";
    return `${Holder.value}:${holder.value}:${Holder.hasOwnProperty("value")}:${holder.hasOwnProperty("value")}`;
  };
  return (
    <main>
      <span>Result:</span>
      {evaluate()}
    </main>
  );
};
