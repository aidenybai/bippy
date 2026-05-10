interface BippyFeature {
  label: string;
  detail: string;
}

const BIPPY_FEATURES: BippyFeature[] = [
  {
    label: "No React changes",
    detail: "works outside of React",
  },
  {
    label: "Modern React",
    detail: "supports v17-19",
  },
  {
    label: "Fiber utilities",
    detail: "no source knowledge required",
  },
];

export const ProjectInfo = () => {
  return (
    <section className="flex w-full max-w-faq flex-col">
      <div className="flex items-center gap-2">
        <img src="/bippy.png" alt="bippy" width={28} height={28} className="rounded-md" />
        <h1 className="whitespace-collapse-preserve font-openrunde-semibold text-faq-title font-semibold text-foreground">
          bippy
        </h1>
      </div>
      <p className="mt-intro-gap font-openrunde-medium text-hero-body font-medium tracking-normal text-muted-foreground">
        bippy is a toolkit to{" "}
        <span className="font-openrunde-semibold font-semibold text-foreground">
          hack into React internals
        </span>
      </p>
      <p className="mt-5 font-openrunde-medium text-faq-answer leading-[25px] font-medium tracking-normal text-soft-foreground">
        by default, you cannot access React internals. bippy bypasses this by
        &ldquo;pretending&rdquo; to be React DevTools, giving you access to the fiber tree and other
        internals.
      </p>
      <div className="mt-6 flex flex-col">
        {BIPPY_FEATURES.map((feature, featureIndex) => (
          <div key={feature.label}>
            {featureIndex > 0 && <div className="h-px bg-divider" />}
            <div className="flex items-center justify-between gap-5 py-2">
              <div className="font-openrunde-semibold text-feature-label font-semibold text-feature">
                {feature.label}
              </div>
              <div className="text-right font-openrunde-medium text-feature-label font-medium text-soft-foreground">
                {feature.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
