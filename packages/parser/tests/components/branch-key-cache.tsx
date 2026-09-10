const cache = new Map<string, string>();

const compile = (prop: string, value: string): string => {
  const key = prop + value;
  const cached = cache.get(key);
  if (cached != null) return cached;
  const identifier = `r-${prop}-${key.length}`;
  cache.set(key, identifier);
  return identifier;
};

const CHANNELS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const BranchKeyCache = () => {
  const now = Date.now();
  const classNames = CHANNELS.map((channel) => {
    const isTinted = now % channel === 0;
    return compile("backgroundColor", isTinted ? `rgba(${now % 255},0,0,${channel})` : "");
  });
  const plain = compile("backgroundColor", "");
  return (
    <ul>
      {classNames.map((className, index) => (
        <li key={index} data-css={className} />
      ))}
      {plain ? <b data-css={plain} /> : <s />}
    </ul>
  );
};

export default BranchKeyCache;
export const isExact = true;
