export interface BranchOutcome {
  branchKey: string;
  isTrue: boolean;
}

export const getOutcomeKey = (branchKey: string, isTrue: boolean): string =>
  `${branchKey}:${isTrue}`;

export const parseOutcomeKey = (outcomeKey: string): BranchOutcome => {
  const separator = outcomeKey.lastIndexOf(":");
  return {
    branchKey: outcomeKey.slice(0, separator),
    isTrue: outcomeKey.slice(separator + 1) === "true",
  };
};
