interface Draft {
  id: number;
  tags: string[];
  author: { name: string; active: boolean };
}

const original: Draft = { id: 7, tags: ["a", "b"], author: { name: "jo", active: true } };

const ClonedDraft = () => {
  const copy = structuredClone(original);
  copy.tags.push("c");
  copy.author.name = "kim";
  const scalar = structuredClone(42);
  return (
    <dl>
      {original.tags.length === 2 && <dt>original tags intact</dt>}
      {copy.tags.length === 3 && <dd>copy tags extended</dd>}
      {original.author.name === "jo" && <dt>original author intact</dt>}
      {copy.author.name === "kim" && <dd>copy author renamed</dd>}
      {scalar === 42 && <dd>scalar</dd>}
      {copy.author.active && <b>active</b>}
    </dl>
  );
};

const SpreadString = () => {
  const letters = [..."hey"];
  const wide = [..."a😀b"];
  return (
    <ol data-count={letters.length}>
      {letters.map((letter) => (
        <li key={letter}>{letter}</li>
      ))}
      {[...wide, "!"].map((glyph) => (
        <li key={glyph}>{glyph}</li>
      ))}
    </ol>
  );
};

export default function StructuredData() {
  return (
    <div>
      <ClonedDraft />
      <SpreadString />
    </div>
  );
}

export const isExact = true;
