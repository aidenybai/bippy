import { ActionButtons } from "@/components/action-buttons";
import { CommandDisplay } from "@/components/command-display";
import { FiberCanvas } from "@/components/fiber-viz/fiber-canvas";
import { ProjectInfo } from "@/components/project-info";
import { TooltipProvider } from "@/components/ui/tooltip";

const GITHUB_URL = "https://github.com/aidenybai/bippy";

export const App = () => {
  return (
    <TooltipProvider delay={0} closeDelay={0}>
      <div className="font-synthesis-none flex min-h-svh flex-col overflow-x-clip bg-background antialiased">
        <main className="flex w-full flex-1 items-center justify-center">
          <section className="grid w-full max-w-224 items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,26.8125rem)_minmax(0,1fr)] lg:gap-12 lg:px-0">
            <div className="flex min-w-0 flex-col gap-6">
              <ProjectInfo />
              <CommandDisplay />
              <ActionButtons />
            </div>

            <div className="min-w-0 rounded-lg border border-divider bg-background p-3 shadow-button sm:p-4">
              <FiberCanvas />
            </div>
          </section>
        </main>

        <footer className="mx-auto flex w-full max-w-224 items-center gap-[0.9375rem] px-4 pt-4 pb-8 text-caption font-medium sm:px-6 lg:px-0">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground transition-none hover:text-foreground"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/bippy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground transition-none hover:text-foreground"
          >
            npm
          </a>
          <a
            href="/llms.txt"
            className="text-muted-foreground transition-none hover:text-foreground"
          >
            llms.txt
          </a>
        </footer>
      </div>
    </TooltipProvider>
  );
};
