import { makeBadge } from "badge-maker";
import { unstable_cache } from "next/cache";

const getNpmData = async (url: string): Promise<unknown> => {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`npm returned ${response.status}`);
  }
  return response.json();
};

export const formatDownloads = (downloads: number): string => {
  const prefixes = ["", "k", "M", "G", "T", "P", "E"];
  for (let index = prefixes.length - 1; index > 0; index--) {
    const scaledDownloads = downloads / 1000 ** index;
    if (scaledDownloads >= 1) {
      const roundedDownloads = Number(scaledDownloads.toFixed(scaledDownloads < 10 ? 1 : 0));
      return roundedDownloads < 1000
        ? `${roundedDownloads}${prefixes[index]}`
        : `1${prefixes[index + 1]}`;
    }
  }
  return String(downloads);
};

export const getVersion = unstable_cache(
  async (): Promise<string> => {
    const data = await getNpmData("https://registry.npmjs.org/bippy/latest");
    if (
      !data ||
      typeof data !== "object" ||
      !("version" in data) ||
      typeof data.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(data.version)
    ) {
      throw new Error("Invalid npm version");
    }
    return `v${data.version}`;
  },
  ["npm-badge-version"],
  { revalidate: 3600 },
);

export const getDownloads = unstable_cache(
  async (): Promise<string> => {
    const data = await getNpmData(
      "https://api.npmjs.org/downloads/range/1000-01-01:3000-01-01/bippy",
    );
    if (
      !data ||
      typeof data !== "object" ||
      !("downloads" in data) ||
      !Array.isArray(data.downloads) ||
      data.downloads.length === 0
    ) {
      throw new Error("Invalid npm downloads");
    }
    const downloadEntries: unknown[] = data.downloads;
    let totalDownloads = 0;
    for (const entry of downloadEntries) {
      if (
        !entry ||
        typeof entry !== "object" ||
        !("downloads" in entry) ||
        typeof entry.downloads !== "number" ||
        !Number.isSafeInteger(entry.downloads) ||
        entry.downloads < 0
      ) {
        throw new Error("Invalid npm download count");
      }
      totalDownloads += entry.downloads;
    }
    if (!Number.isSafeInteger(totalDownloads)) {
      throw new Error("Invalid npm download total");
    }
    return formatDownloads(totalDownloads);
  },
  ["npm-badge-downloads"],
  { revalidate: 3600 },
);

export const getBadgeResponse = async (
  label: string,
  getMessage: () => Promise<string>,
): Promise<Response> => {
  let message: string;
  let status = 200;
  try {
    message = await getMessage();
  } catch {
    message = "unavailable";
    status = 502;
  }
  return new Response(
    makeBadge({ label, message, style: "flat", labelColor: "#000000", color: "#000000" }),
    {
      status,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control":
          status === 200
            ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400"
            : "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
};
