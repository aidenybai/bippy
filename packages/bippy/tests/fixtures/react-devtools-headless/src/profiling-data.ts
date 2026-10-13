export interface ProfilingDataExport {
  dataForRoots: unknown[];
  version: number;
}

export interface ImportedProfilingData {
  dataForRoots: Map<number, unknown>;
  imported: true;
}

export const prepareProfilingDataFrontendFromExport = (
  data: ProfilingDataExport,
): ImportedProfilingData => {
  if (data.version !== 5) {
    throw new Error(
      `Unsupported profile export version "${data.version}". Supported version is "5".`,
    );
  }
  return { dataForRoots: new Map(), imported: true };
};
