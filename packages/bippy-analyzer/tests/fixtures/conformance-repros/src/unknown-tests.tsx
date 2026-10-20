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

export const TrimmedInput = ({ input }: { input?: string }) => {
  const count = (input as string).trim().length;
  const hasInput = count > 0;
  return (
    <div>
      {hasInput && <b>search</b>}
      {!hasInput && <i>trending</i>}
    </div>
  );
};

export const FallbackLength = ({ input }: { input?: string }) => {
  const count = (input ?? "x").length;
  const hasInput = count > 0;
  return (
    <div>
      {hasInput && <b>search</b>}
      {!hasInput && <i>trending</i>}
    </div>
  );
};
