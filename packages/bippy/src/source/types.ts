export interface FiberSource {
  columnNumber?: number;
  fileName: string;
  lineNumber?: number;
  functionName?: string;
}

export type MaybeFiberSource = FiberSource & {
  fileName?: string | undefined;
};
