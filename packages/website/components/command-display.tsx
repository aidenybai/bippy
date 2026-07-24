import { Copy, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const BIPPY_COMMAND = "npm install bippy";
const BIPPY_AGENT_DISPLAY_PROMPT = "npm install bippy, then fetch bippy.dev/llms.txt for more info";
const BIPPY_AGENT_CLIPBOARD_PROMPT =
  "Install bippy (must be imported before React) and set up instrument() to hook into React DevTools internals. Use traverseRenderedFibers to detect re-renders, traverseFiber to walk the fiber tree, and traverseProps/traverseState/traverseContexts to inspect component data. See https://bippy.dev for the full API.";

export const CommandDisplay = () => {
  const [activeTab, setActiveTab] = useState("command");
  const [copyStatus, setCopyStatus] = useState("idle");
  const resetCopyStatusTimeoutRef = useRef<number | null>(null);
  const commandText = activeTab === "command" ? BIPPY_COMMAND : BIPPY_AGENT_DISPLAY_PROMPT;
  const clipboardText = activeTab === "command" ? BIPPY_COMMAND : BIPPY_AGENT_CLIPBOARD_PROMPT;
  const didCopy = copyStatus === "copied";

  useEffect(() => {
    return () => {
      if (resetCopyStatusTimeoutRef.current !== null) {
        window.clearTimeout(resetCopyStatusTimeoutRef.current);
      }
    };
  }, []);

  const handleTabChange = (tab: string): void => {
    setActiveTab(tab);
    setCopyStatus("idle");
  };

  const copyCommand = async (): Promise<void> => {
    if (resetCopyStatusTimeoutRef.current !== null) {
      window.clearTimeout(resetCopyStatusTimeoutRef.current);
    }
    try {
      await navigator.clipboard.writeText(clipboardText);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    resetCopyStatusTimeoutRef.current = window.setTimeout(() => setCopyStatus("idle"), 2_000);
  };

  return (
    <section className="flex w-full max-w-faq flex-col gap-3">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList>
          <TabsTrigger value="command">Command line</TabsTrigger>
          <TabsTrigger value="agent">Agent prompt</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-button px-3 py-2 shadow-button">
        <code className="min-w-0 break-words font-mono text-feature-label text-feature">
          {commandText}
        </code>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                onClick={() => void copyCommand()}
                aria-label="Copy command"
                className="text-muted-foreground"
              />
            }
          >
            {didCopy ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </TooltipTrigger>
          <TooltipContent>
            {didCopy ? "Copied!" : copyStatus === "failed" ? "Could not copy" : "Copy to clipboard"}
          </TooltipContent>
        </Tooltip>
      </div>
    </section>
  );
};
