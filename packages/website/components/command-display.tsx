"use client";

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
    <div className="flex w-full flex-col gap-3">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList variant="line">
          <TabsTrigger value="command">Command line</TabsTrigger>
          <TabsTrigger value="agent">Agent prompt</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex items-center justify-between pt-0.5 pb-2.25">
        <code className="font-mono text-sm">{commandText}</code>
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
    </div>
  );
};
