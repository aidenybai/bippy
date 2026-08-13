import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const classNames = (...classValues: ClassValue[]): string => twMerge(clsx(classValues));
