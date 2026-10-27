export const makeSetter = (setValue: (value: number) => void, value: number) => () =>
  setValue(value);
