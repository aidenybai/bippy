interface SearchCase {
  name: "find" | "findIndex" | "findLast" | "findLastIndex";
}
const cases: SearchCase[] = [
  { name: "find" },
  { name: "findIndex" },
  { name: "findLast" },
  { name: "findLastIndex" },
];
export default () => (
  <div>
    {cases.map(({ name }) => {
      const visited: number[] = [];
      const result = [1, 2, 3][name]((value) => {
        visited.push(value);
        return value === 2;
      });
      return (
        <main key={name}>
          <span>Search:</span>
          {`${name}:${result}:${visited.join(",")}`}
        </main>
      );
    })}
  </div>
);
