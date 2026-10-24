declare function searchTitles(query: string, limit: number): string[];

export const SearchResults = ({ query }: { query: string }) => {
  const pageSize = 20;
  let titles: string[] = [];
  try {
    titles = searchTitles(query, pageSize);
  } catch {}
  return titles.length === 0 ? <p>No results</p> : <p>{titles.length} results</p>;
};
