export const queue: number[] = [];

export let total = 0;

export const bumpTotal = () => {
  total += 1;
};

export const session = { visits: 0 };
