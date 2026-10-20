export interface CardOptions {
  shape?: string;
  width?: number;
}

export const normalizeOptions = (options: CardOptions): void => {
  options.shape = options.shape ?? "auto";
};

export const fillDefaults = (target: CardOptions, width: number): void => {
  const settings = target;
  settings.width = width;
};

export const describeOptions = (options: CardOptions): string => options.shape ?? "auto";
