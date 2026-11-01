const QUOTED_LITERAL = /"(?:[^"\\]|\\.)*"/g;

export const truncate = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text;

export const unescapeQuotedLiterals = (text: string): string =>
  text.replaceAll(QUOTED_LITERAL, (literal) => {
    try {
      return `"${JSON.parse(literal)}"`;
    } catch {
      return literal;
    }
  });
