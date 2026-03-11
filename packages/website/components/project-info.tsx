import Image from "next/image";

const BIPPY_FEATURES = [
  "Works outside of React \u2013 no React code modification needed",
  "Utility functions that work across modern React (v17\u201319)",
  "No prior React source code knowledge required",
];

export const ProjectInfo = () => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Image
          src="/bippy.png"
          alt="bippy"
          width={24}
          height={24}
          className="rounded"
          unoptimized
        />
        <h1 className="text-base font-medium tracking-tight">bippy</h1>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        bippy is a toolkit to <span className="font-medium text-foreground">hack into React internals</span>
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        by default, you cannot access React internals. bippy bypasses this by &ldquo;pretending&rdquo; to be React DevTools, giving you access to the fiber tree and other internals.
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-sm leading-relaxed text-muted-foreground">
        {BIPPY_FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </div>
  );
};
