"use client";

import Image from "next/image";
import NextLink from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { guideChapters } from "@/components/guide/guide-chapters";
import { GuideShowcase } from "@/components/guide/guide-showcases";
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
      "flex min-h-[82dvh] scroll-mt-12 flex-col justify-center py-20 transition-opacity duration-500 lg:min-h-[96dvh] lg:py-28",
      isActive ? "lg:opacity-100" : "lg:opacity-[0.32]",
    )}
    data-guide-section={sectionIndex}
  >
    <p className="mb-4 font-mono text-xs font-medium tracking-[0.12em] text-[#61dafb]">
      {eyebrow}
    </p>
    <h2 className="max-w-xl text-2xl font-medium tracking-[-0.025em] text-white sm:text-3xl">
      {title}
    </h2>
    <div className="mt-6 max-w-xl space-y-5 text-base leading-7 text-white/56">{children}</div>
    <div className="mt-10 lg:hidden">
      <GuideShowcase activeSectionIndex={sectionIndex} compact />
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
    <main className="min-h-screen bg-[#0b0c0f] text-foreground selection:bg-[#61dafb]/25">
      <div className="mx-auto grid w-full max-w-[1536px] lg:grid-cols-[minmax(0,0.9fr)_minmax(34rem,1.1fr)]">
        <article className="px-6 sm:px-10 lg:px-14 xl:px-20">
          <header className="flex h-20 items-center justify-between">
            <NextLink className="flex items-center gap-2.5" href="/">
              <Image src="/icon.png" alt="" width={24} height={24} priority />
              <span className="text-sm font-medium tracking-tight text-white">bippy</span>
            </NextLink>
            <a
              className="font-mono text-xs tracking-[0.08em] text-white/35 transition hover:text-[#61dafb]"
              href="https://github.com/aidenybai/bippy"
            >
              GitHub ↗
            </a>
          </header>

          <section
            ref={getSectionReference(0)}
            className={cn(
              "flex min-h-[calc(100dvh-5rem)] flex-col justify-center py-16 transition-opacity duration-500 lg:py-24",
              activeSectionIndex === 0 ? "lg:opacity-100" : "lg:opacity-[0.32]",
            )}
            data-guide-section="0"
          >
            <p className="mb-5 font-mono text-xs font-medium tracking-[0.12em] text-[#61dafb]">
              a field guide to React&apos;s other tree
            </p>
            <h1 className="max-w-2xl font-serif text-5xl leading-[0.98] font-normal tracking-[-0.045em] text-white sm:text-6xl xl:text-7xl">
              What bippy
              <br />
              actually is.
            </h1>
            <div className="mt-8 max-w-xl space-y-5 text-base leading-7 text-white/58">
              <p>
                Give me one render and I&apos;ll show you the component that made it, what it
                received, and where React put it.
              </p>
              <p>
                Click the counter. The card on this page is only React UI. The render signal behind
                it is what bippy is built to catch.
              </p>
              <p className="border-l border-[#61dafb]/35 pl-4 text-white/38">
                bippy is not a browser extension or a DevTools panel. It is a tiny library you load
                into your app before React.
              </p>
            </div>
            <p className="mt-10 text-xs text-white/25 lg:hidden">
              This guide has a scroll-synced lab on desktop. You still get every experiment here.
            </p>
            <div className="mt-10 lg:hidden">
              <GuideShowcase activeSectionIndex={0} compact />
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

          <footer className="flex items-center justify-between border-t border-white/8 py-8 text-xs text-white/25">
            <span>bippy · React internals without the ceremony</span>
            <NextLink className="transition hover:text-white" href="/">
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
