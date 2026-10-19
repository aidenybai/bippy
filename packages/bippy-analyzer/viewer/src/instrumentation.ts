export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ask } = await import("./server/analyzer-client");
  await ask({ kind: "examples" });
};
