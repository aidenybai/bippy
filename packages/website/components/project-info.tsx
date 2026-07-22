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
    </section>
  );
};
