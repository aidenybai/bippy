let powerOfTwo = 0;

const increment = (): number => 2 ** powerOfTwo++;

export const boolean = increment();
export const number = increment();
export const spaceSeparated = increment();
export const commaSeparated = increment();

export default "flags";
