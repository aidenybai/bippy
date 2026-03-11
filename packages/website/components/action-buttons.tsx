"use client";

import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";

const GITHUB_URL = "https://github.com/aidenybai/bippy";

export const ActionButtons = () => {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="text-foreground"
        asChild
      >
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          <GitHubIcon className="size-3.25" />
          Star on GitHub
        </a>
      </Button>
    </div>
  );
};
