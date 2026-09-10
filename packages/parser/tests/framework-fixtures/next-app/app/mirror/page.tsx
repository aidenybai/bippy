import { readCatalog } from "@/lib/catalog";

export default async function MirrorPage() {
  const catalog = await readCatalog();
  return (
    <ul>
      {catalog.map((entry) => (
        <li key={entry}>{entry}</li>
      ))}
    </ul>
  );
}
