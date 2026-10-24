interface Line {
  tone: "good" | "bad";
  emphasis?: string;
}

export const TonedText = ({ line, text }: { line: Line; text: string }) => {
  const at = line.emphasis ? text.lastIndexOf(line.emphasis) : -1;
  if (at < 0) return <span>{text}</span>;
  const end = at + line.emphasis!.length;
  return (
    <span>
      {text.slice(0, at)}
      <em>{line.emphasis}</em>
      {text.slice(end)}
    </span>
  );
};
