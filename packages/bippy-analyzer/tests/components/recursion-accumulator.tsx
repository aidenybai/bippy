export const isExact = true;

const collectLabels = (depth: number, labels: string[]): string[] => {
  if (depth === 0) return labels;
  labels.push(`level-${depth}`);
  return collectLabels(depth - 1, labels);
};

const appendSquares = (limit: number, squares: number[]): number[] => {
  if (squares.length >= limit) return squares;
  return appendSquares(limit, [...squares, squares.length * squares.length]);
};

interface Trail {
  visited: string[];
}

const walkTrail = (steps: string[], trail: Trail): Trail => {
  if (steps.length === 0) return trail;
  trail.visited.push(steps[0]);
  return walkTrail(steps.slice(1), trail);
};

export default function RecursionAccumulator() {
  const labels = collectLabels(4, []);
  const squares = appendSquares(5, []);
  const trail = walkTrail(["north", "east", "south"], { visited: [] });
  return (
    <section>
      <ul>
        {labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <output>{squares.join(",")}</output>
      <p>{trail.visited.join(" > ")}</p>
    </section>
  );
}
