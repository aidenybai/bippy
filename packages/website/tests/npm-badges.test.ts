import { makeBadge } from "badge-maker";
import { unstable_cache } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GET as getVersionBadge } from "../app/api/badges/version/route";
import { GET as getDownloadsBadge } from "../app/api/badges/downloads/route";
import { formatDownloads, getBadgeResponse } from "../lib/npm-badges";

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((callback: () => Promise<string>) => callback),
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("npm badges", () => {
  it("revalidates separately cached, validated npm values every hour", () => {
    expect(unstable_cache).toHaveBeenCalledWith(expect.any(Function), ["npm-badge-version"], {
      revalidate: 3600,
    });
    expect(unstable_cache).toHaveBeenCalledWith(expect.any(Function), ["npm-badge-downloads"], {
      revalidate: 3600,
    });
  });

  it("renders the same flat black npm version badge as Shields", async () => {
    fetchMock.mockResolvedValue(Response.json({ version: "0.7.3" }));
    const response = await getVersionBadge();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      makeBadge({
        label: "npm",
        message: "v0.7.3",
        style: "flat",
        labelColor: "#000000",
        color: "#000000",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith("https://registry.npmjs.org/bippy/latest", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400",
    );
  });

  it("sums the available 18-month download range like Shields' dt redirect", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ downloads: [{ downloads: 50_000_000 }, { downloads: 10_000_000 }] }),
    );
    const response = await getDownloadsBadge();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      makeBadge({
        label: "downloads",
        message: "60M",
        style: "flat",
        labelColor: "#000000",
        color: "#000000",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.npmjs.org/downloads/range/1000-01-01:3000-01-01/bippy",
      { cache: "no-store", signal: expect.any(AbortSignal) },
    );
  });

  it("renders zero downloads", async () => {
    fetchMock.mockResolvedValue(Response.json({ downloads: [{ downloads: 0 }] }));
    const response = await getDownloadsBadge();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>downloads: 0</title>");
  });

  it("accepts prerelease versions", async () => {
    fetchMock.mockResolvedValue(Response.json({ version: "1.2.3-beta.1+build.2" }));
    expect(await (await getVersionBadge()).text()).toContain("npm: v1.2.3-beta.1+build.2");
  });

  it.each([null, {}, { version: 123 }, { version: "" }, { version: "<script/>" }])(
    "does not cache invalid version payload %j",
    async (data) => {
      fetchMock.mockResolvedValue(Response.json(data));
      const response = await getVersionBadge();
      expect(response.status).toBe(502);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).toContain("<title>npm: unavailable</title>");
    },
  );

  it.each([
    null,
    {},
    { downloads: [] },
    { downloads: 123 },
    { downloads: [null] },
    { downloads: [{}] },
    { downloads: [{ downloads: -1 }] },
    { downloads: [{ downloads: "100" }] },
    { downloads: [{ downloads: 1.5 }] },
    { downloads: [{ downloads: Number.MAX_SAFE_INTEGER }, { downloads: 1 }] },
  ])("does not cache invalid downloads payload %j", async (data) => {
    fetchMock.mockResolvedValue(Response.json(data));
    const response = await getDownloadsBadge();
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toContain("<title>downloads: unavailable</title>");
  });

  it.each([404, 429, 500, 503])("handles npm HTTP %i without caching failures", async (status) => {
    fetchMock.mockResolvedValue(new Response("upstream error", { status }));
    const response = await getVersionBadge();
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("handles malformed JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not json"));
    expect((await getDownloadsBadge()).status).toBe(502);
  });

  it.each([new Error("offline"), new DOMException("timed out", "TimeoutError")])(
    "recovers after an upstream failure: %s",
    async (error) => {
      fetchMock.mockRejectedValueOnce(error);
      const failedResponse = await getVersionBadge();
      expect(failedResponse.status).toBe(502);
      expect(failedResponse.headers.get("Cache-Control")).toBe("no-store");
      fetchMock.mockResolvedValueOnce(Response.json({ version: "0.7.4" }));
      const recoveredResponse = await getVersionBadge();
      expect(recoveredResponse.status).toBe(200);
      expect(await recoveredResponse.text()).toContain("<title>npm: v0.7.4</title>");
    },
  );

  it("escapes SVG text", async () => {
    const response = await getBadgeResponse("<label>", async () => "<script>&");
    const svg = await response.text();
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&amp;");
  });
});

it.each([
  [0, "0"],
  [999, "999"],
  [1000, "1k"],
  [1234, "1.2k"],
  [9950, "9.9k"],
  [9999, "10k"],
  [12_345, "12k"],
  [999_499, "999k"],
  [999_500, "1M"],
  [1_200_000, "1.2M"],
  [60_000_000, "60M"],
  [1_000_000_000, "1G"],
  [1_000_000_000_000, "1T"],
  [Number.MAX_SAFE_INTEGER, "9P"],
])("formats %i downloads as %s", (downloads, expected) => {
  expect(formatDownloads(downloads)).toBe(expected);
});
