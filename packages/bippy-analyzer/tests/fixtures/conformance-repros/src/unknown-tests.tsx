/**
 * Two values the analysis can't see are different values, though both print as
 * `Unknown(spread)`, so learning one is falsy says nothing about the other.
 */

interface Query {
  isLoading: boolean;
  isError: boolean;
}

// memos web/src/pages/Attachments.tsx:190
export function QueryStatus({ query }: { query: Query }) {
  const status = { ...query };
  if (status.isLoading) return <p>Loading</p>;
  if (status.isError) return <p>Error</p>;
  return <p>Done</p>;
}
