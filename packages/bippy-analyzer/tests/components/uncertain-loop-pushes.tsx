const Pips = ({ count }: { count: number }) => {
  const pips = [];
  for (let index = 0; index < count; index++) {
    pips.push(<span key={index} className="pip" />);
  }
  return <div>{pips}</div>;
};

export const isPartial = true;

export default function UncertainLoopPushes() {
  return <Pips count={Math.min(2, Date.now())} />;
}
