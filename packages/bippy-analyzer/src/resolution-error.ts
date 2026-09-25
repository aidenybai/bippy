export const getResolutionError = (error: unknown): string => {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    seen.add(error);
    messages.push(error.message);
    error = error.cause;
  }
  if (error !== undefined && !seen.has(error)) messages.push(String(error));
  return messages.length ? messages.join(": ") : String(error);
};
