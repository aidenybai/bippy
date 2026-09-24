// Mirrors Babel's cleanJSXElementLiteralChild, which oxc/esbuild/swc replicate.
export const cleanJsxText = (rawText: string): string => {
  const lines = rawText.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  lines.forEach((line, index) => {
    if (/[^ \t]/.test(line)) lastNonEmptyLine = index;
  });
  let result = "";
  lines.forEach((line, index) => {
    const isFirstLine = index === 0;
    const isLastLine = index === lines.length - 1;
    const isLastNonEmptyLine = index === lastNonEmptyLine;
    let trimmedLine = line.replaceAll("\t", " ");
    if (!isFirstLine) trimmedLine = trimmedLine.replace(/^ +/, "");
    if (!isLastLine) trimmedLine = trimmedLine.replace(/ +$/, "");
    if (trimmedLine) {
      if (!isLastNonEmptyLine) trimmedLine += " ";
      result += trimmedLine;
    }
  });
  return result;
};
