const routes = ["one", "two", "three"];

export default function BranchValuedListBounds() {
  const visible = window.location.hash === "#all" ? routes.length : 1;
  const skipped = window.location.hash === "#tail" ? 2 : 0;
  const shown = routes.slice(0, visible);
  const rest = routes.slice(skipped);
  const placeholders = Array.from({ length: visible }, (_, index) => `slot-${index}`);
  const blanks = Array(visible).fill("blank");
  return (
    <main>
      <ol>
        {shown.map((route) => (
          <li key={route}>{route}</li>
        ))}
      </ol>
      <ul>
        {rest.map((route) => (
          <li key={route}>{route}</li>
        ))}
      </ul>
      <p>{placeholders.join(",")}</p>
      <p>{blanks.length}</p>
    </main>
  );
}

export const isPartial = true;
