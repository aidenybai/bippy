import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSite } from "@/providers/site-provider";

const BIPPY_COMMAND = "npm install bippy";
const BIPPY_AGENT_PROMPT = "npm install bippy, then fetch bippy.dev/llms.txt for more info";

export const CommandDisplay = () => {
  const { activeTab, copied, setActiveTab, copyCommand } = useSite();
  const commandText = activeTab === "command" ? BIPPY_COMMAND : BIPPY_AGENT_PROMPT;

  return (
    <section className="flex w-full max-w-faq flex-col gap-3">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList variant="line">
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
                variant="ghost"
                size="icon-sm"
                onClick={copyCommand}
                aria-label="Copy command"
                className="text-muted-foreground"
              />
            }
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied!" : "Copy to clipboard"}</TooltipContent>
        </Tooltip>
      </div>
    </section>
  );
};
