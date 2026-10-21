export const memoizeByIdentity = <Input extends object, Output>(
  derive: (input: Input) => Output,
): ((input: Input) => Output) => {
  const outputs = new WeakMap<Input, { output: Output }>();
  return (input) => {
    const cached = outputs.get(input);
    if (cached) return cached.output;
    const output = derive(input);
    outputs.set(input, { output });
    return output;
  };
};
