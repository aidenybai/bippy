const TYPESCRIPT_PANIC_PATTERN = /^panic: /;

export const queryType = <Result>(query: () => Result): Result | null => {
  try {
    return query();
  } catch (error) {
    if (error instanceof Error && TYPESCRIPT_PANIC_PATTERN.test(error.message)) return null;
    throw error;
  }
};
