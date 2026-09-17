interface RepoSummary {
  fullName: string;
  stars: number;
}

document.title = JSON.stringify({ fullName: "acme/widgets", stars: 1200 });

const readSummary = (): RepoSummary | null => {
  const summary: RepoSummary | null = JSON.parse(document.title);
  if (!summary) return null;
  return { fullName: summary.fullName, stars: summary.stars };
};

const formatCount = (count: number): string => (count >= 1000 ? `${count / 1000}k` : String(count));

const StarsBadge = ({ showRepo }: { showRepo: boolean }) => {
  const summary = readSummary();
  const stars = summary?.stars ?? null;
  const fullName = summary?.fullName ?? "owner/repo";
  return (
    <a href="https://example.com" aria-label={`${fullName}${stars !== null ? ` — ${stars}` : ""}`}>
      <svg />
      {showRepo && <span data-name={fullName} />}
      {stars !== null && (
        <>
          {showRepo && <span aria-hidden="true" />}
          <span>{formatCount(stars)}</span>
        </>
      )}
    </a>
  );
};

const NestedChain = () => {
  const summary = readSummary();
  const label = summary?.fullName?.toUpperCase() ?? "anonymous";
  const length = summary?.fullName.length;
  return (
    <p data-label={label} data-length={length}>
      {summary?.stars !== undefined ? <b>starred</b> : <i>unstarred</i>}
    </p>
  );
};

export default function OptionalChains() {
  return (
    <div>
      <StarsBadge showRepo />
      <StarsBadge showRepo={false} />
      <NestedChain />
    </div>
  );
}
