export const callListener = <Arguments extends unknown[]>(
  listener: (...listenerArguments: Arguments) => unknown,
  receiver: unknown,
  ...listenerArguments: Arguments
): void => {
  try {
    listener.apply(receiver, listenerArguments);
  } catch (error) {
    try {
      console.error("Bippy instrumentation encountered an error:", error);
    } catch {}
  }
};
