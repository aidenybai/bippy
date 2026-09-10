const glyphMap: Record<string, number | string> = {
  home: 0xf015,
  search: 0xf002,
  literal: "*",
};

const Glyph = ({ name }: { name: string }) => {
  let glyph = name ? (glyphMap[name] ?? "?") : "";
  if (typeof glyph === "number") {
    glyph = String.fromCodePoint(glyph);
  }
  return (
    <span>
      {glyph}
      <i />
    </span>
  );
};

const describeCodePoint = (codePoint: number): string => {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "invalid";
  }
};

export const isExact = true;

export default function StringCodePoints() {
  return (
    <ul>
      <li>
        <Glyph name="home" />
        <Glyph name="search" />
        <Glyph name="literal" />
        <Glyph name="missing" />
        <Glyph name="" />
      </li>
      <li>
        {String.fromCharCode(72, 105)}
        <i />
      </li>
      <li>
        {String.fromCodePoint(0x1f600).length}
        <i />
      </li>
      <li>
        {describeCodePoint(0x110000)}
        <i />
      </li>
      <li>
        {describeCodePoint(65)}
        <i />
      </li>
    </ul>
  );
}
