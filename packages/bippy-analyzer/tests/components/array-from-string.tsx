interface Segment {
  indices: [number, number];
  label: string;
}

const text = "Hi 👋 @strad3r!";
const codePoints = Array.from(text);
const upperCased = Array.from(text, (character) => character.toUpperCase());

const segments: Segment[] = [
  { indices: [0, 5], label: "greeting" },
  { indices: [5, 13], label: "mention" },
  { indices: [13, 14], label: "punctuation" },
];

export default function ArrayFromString() {
  return (
    <p data-code-points={codePoints.length} data-utf16-units={text.length}>
      {segments.map(({ indices, label }) => (
        <span key={label} className={label}>
          {codePoints.slice(indices[0], indices[1]).join("")}
        </span>
      ))}
      <em>
        {upperCased.join("")} spans {codePoints.length} code points in {text.length} units
      </em>
    </p>
  );
}
