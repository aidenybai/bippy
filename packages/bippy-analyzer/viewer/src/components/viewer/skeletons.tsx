import { Skeleton } from "@/components/ui/skeleton";

const MAX_LINES = 200;

interface CodeSkeletonProps {
  source: string;
}

interface SkeletonLine {
  offset: number;
  line: string;
}

const toLines = (source: string): SkeletonLine[] => {
  const lines: SkeletonLine[] = [];
  let offset = 0;
  for (const line of source.split("\n").slice(0, MAX_LINES)) {
    lines.push({ offset, line });
    offset += line.length + 1;
  }
  return lines;
};

export const CodeSkeleton = ({ source }: CodeSkeletonProps) => {
  const lines = toLines(source);
  return (
    <div className="grid pt-[11px] pr-8 pl-[49px] font-mono text-[13px]" aria-busy="true">
      {lines.map(({ offset, line }) => (
        <div key={offset} className="h-5 pt-1">
          {line.trim() !== "" && <Skeleton className="h-3" style={{ width: `${line.length}ch` }} />}
        </div>
      ))}
    </div>
  );
};
