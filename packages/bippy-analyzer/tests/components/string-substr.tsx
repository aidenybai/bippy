const PARAM_PATTERN = /:(\w+)/g;

const tokenize = (path: string) => {
  const tokens: string[] = [];
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = PARAM_PATTERN.exec(path)) !== null) {
    tokens.push(path.slice(index, match.index), `{${match[1]}}`);
    index = match.index + match[0].length;
  }
  if (index < path.length) tokens.push(path.substr(index));
  tokens.push(path.substr(-3), path.substr(1, 4), path.substr(0));
  return tokens;
};

export const isExact = true;

export default function StringSubstr() {
  return (
    <ol>
      {tokenize("/admin/:table/rows/:id").map((token, position) => (
        <li key={position}>{token.length > 3 ? <b>{token}</b> : token}</li>
      ))}
    </ol>
  );
}
