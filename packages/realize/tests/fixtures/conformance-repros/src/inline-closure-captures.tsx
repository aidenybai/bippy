export const HoistedCapture = () => {
  const outer = () => {
    const inner = () => value;
    const value = 3;
    return inner();
  };
  return <div>{outer() === 3 ? <i>three</i> : <i>other</i>}</div>;
};

export const LaterWrite = () => {
  const makeGetter = () => {
    let count = 1;
    const getCount = () => count;
    count = 2;
    return getCount;
  };
  const getCount = makeGetter();
  return <div>{getCount() === 2 ? <i>two</i> : <i>one</i>}</div>;
};
