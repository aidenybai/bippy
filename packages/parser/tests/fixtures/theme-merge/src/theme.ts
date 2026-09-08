import { deepmerge } from "./deepmerge";

export interface Palette {
  [key: string]: unknown;
  mode: string;
  primary: { main: string; contrastText?: string };
  tags: string[];
}

export interface Theme {
  [key: string]: unknown;
  palette: Palette;
  spacing: number;
  shape: { radius: number };
}

class Ruler {
  unit = 8;
}

const base: Theme = {
  palette: { mode: "light", primary: { main: "#1976d2", contrastText: "#fff" }, tags: ["a"] },
  spacing: 8,
  shape: { radius: 4 },
};

export const createTheme = (options: Record<string, unknown>): Theme =>
  deepmerge(deepmerge(base, options), { shape: { ruler: new Ruler() } });
