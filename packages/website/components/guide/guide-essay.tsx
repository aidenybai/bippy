"use client";

import Image from "next/image";
import NextLink from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { guideChapters } from "@/components/guide/guide-chapters";
import { GuideShowcase } from "@/components/guide/guide-showcases";
import { Link } from "@/components/ui/link";
import { cn } from "@/lib/utils";

interface GuideSectionProps {
  children: ReactNode;
  eyebrow: string;
  isActive: boolean;
  sectionIndex: number;
  sectionReference: (element: HTMLElement | null) => void;
  title: string;
}

const GuideSection = ({
  children,
  eyebrow,
  isActive,
  sectionIndex,
  sectionReference,
  title,
}: GuideSectionProps) => (
  <section
    ref={sectionReference}
    className={cn(
      "flex min-h-[64dvh] scroll-mt-12 flex-col justify-center py-16 transition-opacity duration-300",
      isActive ? "lg:opacity-100" : "lg:opacity-60",
    )}
    data-guide-section={sectionIndex}
  >
    <p className="mb-3 text-xs font-medium text-muted-foreground">{eyebrow}</p>
    <h2 className="max-w-lg text-2xl font-medium text-foreground">{title}</h2>
    <div className="mt-4 max-w-lg space-y-4 text-sm leading-relaxed text-muted-foreground">
      {children}
    </div>
    <div className="mt-8 lg:hidden">
      <GuideShowcase activeSectionIndex={sectionIndex} />
    </div>
  </section>
);

export const GuideEssay = () => {
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const sectionElements = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    let animationFrame = 0;

    const updateActiveSection = (): void => {
      animationFrame = 0;
      const viewportCenter = window.innerHeight / 2;
      let closestSectionIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;

      sectionElements.current.forEach((sectionElement, sectionIndex) => {
        if (!sectionElement) return;
        const sectionBounds = sectionElement.getBoundingClientRect();
        const sectionCenter = sectionBounds.top + sectionBounds.height / 2;
        const distanceFromCenter = Math.abs(sectionCenter - viewportCenter);

        if (distanceFromCenter < closestDistance) {
          closestDistance = distanceFromCenter;
          closestSectionIndex = sectionIndex;
        }
      });

      setActiveSectionIndex(closestSectionIndex);
    };

    const requestActiveSectionUpdate = (): void => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", requestActiveSectionUpdate, { passive: true });
    window.addEventListener("resize", requestActiveSectionUpdate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", requestActiveSectionUpdate);
      window.removeEventListener("resize", requestActiveSectionUpdate);
    };
  }, []);

  const getSectionReference =
    (sectionIndex: number) =>
    (sectionElement: HTMLElement | null): void => {
      sectionElements.current[sectionIndex] = sectionElement;
    };

  return (
    <main className="min-h-screen bg-background text-foreground selection:bg-muted">
      <div className="mx-auto grid w-full max-w-7xl lg:grid-cols-[minmax(0,1fr)_minmax(32rem,1fr)]">
        <article className="px-6 pb-12 sm:px-10 lg:px-12">
          <header className="flex items-center justify-between pt-16 pb-8">
            <NextLink className="flex items-center gap-2" href="/">
              <Image
                className="size-8 object-contain"
                src="/icon.png"
                alt=""
                width={32}
                height={32}
                priority
              />
              <span className="text-xl font-medium tracking-tight">bippy</span>
            </NextLink>
            <Link href="https://github.com/aidenybai/bippy">GitHub</Link>
          </header>

          <section
            ref={getSectionReference(0)}
            className={cn(
              "flex min-h-[58dvh] flex-col justify-center py-16 transition-opacity duration-300",
              activeSectionIndex === 0 ? "lg:opacity-100" : "lg:opacity-60",
            )}
            data-guide-section="0"
          >
            <h1 className="max-w-lg text-3xl font-medium text-foreground">
              bippy is the library under the inspector.
            </h1>
            <div className="mt-4 max-w-lg space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>
                The widget on the homepage is a demo built with bippy. It calls{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  getFiber()
                </code>{" "}
                on its own UI.
              </p>
              <p>
                bippy is not an extension or a DevTools panel. It is a library you import before
                React to inspect Fiber, observe renders, and access the renderer.
              </p>
            </div>
            <p className="mt-6 text-xs text-muted-foreground lg:hidden">
              The examples are scroll-synced on desktop and inline here.
            </p>
            <div className="mt-8 lg:hidden">
              <GuideShowcase activeSectionIndex={0} />
            </div>
          </section>

          {guideChapters.map((guideChapter, chapterIndex) => {
            const sectionIndex = chapterIndex + 1;

            return (
              <GuideSection
                key={guideChapter.eyebrow}
                eyebrow={guideChapter.eyebrow}
                isActive={activeSectionIndex === sectionIndex}
                sectionIndex={sectionIndex}
                sectionReference={getSectionReference(sectionIndex)}
                title={guideChapter.title}
              >
                {guideChapter.content}
              </GuideSection>
            );
          })}

          <footer className="flex items-center justify-between border-t border-border py-8 text-xs text-muted-foreground">
            <span>bippy hacks into React internals.</span>
            <NextLink className="transition-colors hover:text-foreground" href="/">
              back to the inspector
            </NextLink>
          </footer>
        </article>

        <aside className="relative hidden lg:block">
          <div className="sticky top-0 flex h-dvh items-center p-6 xl:p-8">
            <GuideShowcase activeSectionIndex={activeSectionIndex} />
          </div>
        </aside>
      </div>
    </main>
  );
};
