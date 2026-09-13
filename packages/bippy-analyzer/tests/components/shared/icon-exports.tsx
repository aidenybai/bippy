export const IconNameMapper: Record<string, string> = { cog: "CogIcon", tick: "TickIcon" };

export const CogIcon = ({ label }: { label: string }) => (
  <svg data-icon={label}>
    <circle r="4" />
  </svg>
);

export const TickIcon = ({ label }: { label: string }) => (
  <svg data-icon={label}>
    <path d="M0 0" />
  </svg>
);
