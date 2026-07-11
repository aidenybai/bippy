import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { FiberCanvas } from "./fiber-canvas";
import { StepCode } from "./step-code";
import { FIBER_VIZ_STEPS } from "./steps";

const ACTIVE_STEP_VIEWPORT_RATIO = 0.55;

const stepBodyComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="font-openrunde-medium text-faq-answer font-medium tracking-normal text-soft-foreground">
      {children}
    </p>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-feature-label text-foreground">
      {children}
    </code>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <span className="font-openrunde-semibold font-semibold text-foreground">{children}</span>
  ),
};

export const FiberScrollytelling = () => {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const stepElementsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let animationFrameId = 0;

    const updateActiveStep = () => {
      animationFrameId = 0;
      const triggerY = window.innerHeight * ACTIVE_STEP_VIEWPORT_RATIO;
      let nextActiveIndex = 0;
      for (let stepIndex = 0; stepIndex < stepElementsRef.current.length; stepIndex++) {
        const stepElement = stepElementsRef.current[stepIndex];
        if (!stepElement) continue;
        if (stepElement.getBoundingClientRect().top <= triggerY) {
          nextActiveIndex = stepIndex;
        }
      }
      setActiveStepIndex(nextActiveIndex);
    };

    const scheduleUpdate = () => {
      if (animationFrameId) return;
      animationFrameId = window.requestAnimationFrame(updateActiveStep);
    };

    updateActiveStep();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, []);

  const activeStep = FIBER_VIZ_STEPS[activeStepIndex];

  const canvasCard = (
    <div className="w-full rounded-lg border border-divider bg-background p-3 shadow-button sm:p-4">
      <FiberCanvas mode={activeStep.mode} />
    </div>
  );

  return (
    <section className="relative mt-14 flex w-full min-w-0 flex-col items-center px-4 sm:px-0">
      <div className="w-full max-w-page lg:max-w-224">
        <div className="mx-auto w-full max-w-page lg:mx-0 lg:max-w-faq">
          <div className="mb-faq-gap w-full max-w-faq font-openrunde-semibold text-faq-title font-semibold tracking-normal text-section-title">
            how fibers work
          </div>
          <div className="mb-faq-gap h-hairline w-full max-w-faq shrink-0 bg-border" />
          <p className="mb-6 w-full max-w-faq font-openrunde-medium text-faq-answer font-medium tracking-normal text-soft-foreground">
            scroll through the lifecycle of a tiny counter app to see what react does under the
            hood, and where bippy hooks in. hover any fiber to see its pointers, and click the +1
            button to run a real update.
          </p>
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,26.8125rem)_minmax(0,1fr)] lg:gap-12">
          <div className="sticky top-0 z-10 -mx-4 bg-background px-4 pt-3 pb-2 sm:mx-0 sm:px-0 lg:hidden">
            <div className="mx-auto max-w-faq">{canvasCard}</div>
          </div>

          <div className="mx-auto w-full max-w-faq lg:mx-0 lg:max-w-none">
            {FIBER_VIZ_STEPS.map((step, stepIndex) => (
              <div
                key={step.id}
                ref={(stepElement) => {
                  stepElementsRef.current[stepIndex] = stepElement;
                }}
                className={`flex min-h-[45svh] flex-col justify-center gap-3 py-10 transition-opacity duration-300 lg:min-h-[60svh] ${
                  stepIndex === activeStepIndex ? "opacity-100" : "opacity-35"
                }`}
              >
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-[11px] text-faq-icon">
                    {String(stepIndex + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-openrunde-semibold text-faq-title font-semibold tracking-normal text-faq-active">
                    {step.title}
                  </h3>
                </div>
                <Markdown components={stepBodyComponents}>{step.body}</Markdown>
                {step.code && (
                  <StepCode
                    code={step.code}
                    language={step.codeLanguage ?? "typescript"}
                    emphasizedLines={step.highlightedLines}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-[max(1.5rem,calc(50svh-15rem))]">{canvasCard}</div>
          </div>
        </div>
      </div>
    </section>
  );
};
