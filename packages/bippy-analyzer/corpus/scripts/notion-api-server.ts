// Stands in for Notion's private `www.notion.so/api/v3` API, which `notion-client`
// (`NotionAPI#getPage`) calls from `getStaticProps` in Notion-backed blogs and
// which rejects unauthenticated requests from this network. Serves one
// `collection_view_page` database whose rows are the blog posts.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.NOTION_API_PORT ?? 3122);
const pageId = process.env.NOTION_PAGE_ID;
if (!pageId) throw new Error("NOTION_PAGE_ID is required");

const toUuid = (id: string): string =>
  id.includes("-")
    ? id
    : `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;

const rootId = toUuid(pageId);
const collectionId = "0a4f6f2e-8c3d-4b1a-9e57-1c2d3e4f5a60";
const viewId = "1b5a7a3f-9d4e-4c2b-8f68-2d3e4f5a6b71";
const spaceId = "2c6b8b40-ae5f-4d3c-9079-3e4f5a6b7c82";

interface PostRow {
  id: string;
  title: string;
  slug: string;
  summary: string;
  date: string;
  tags: string[];
  category: string | null;
  status: "Public" | "Private";
  type: "Post" | "Page";
  createdTime: number;
}

const posts: PostRow[] = [
  {
    id: "3d7c9c51-bf60-4e4d-a18a-4f5a6b7c8d93",
    title: "Rendering Notion pages with react-notion-x",
    slug: "rendering-notion-pages",
    summary: "How the blog turns a Notion database into static pages.",
    date: "2024-03-12",
    tags: ["nextjs", "notion"],
    category: "Engineering",
    status: "Public",
    type: "Post",
    createdTime: Date.UTC(2024, 2, 12, 9, 30),
  },
  {
    id: "4e8dad62-c071-4f5e-b29b-5a6b7c8d9ea4",
    title: "Dark mode with Emotion themes",
    slug: "dark-mode-with-emotion",
    summary: "Wiring a light/dark scheme through an Emotion ThemeProvider.",
    date: "2024-01-28",
    tags: ["emotion", "css"],
    category: null,
    status: "Public",
    type: "Post",
    createdTime: Date.UTC(2024, 0, 28, 18, 5),
  },
  {
    id: "5f9ebe73-d182-4a6f-c3ac-6b7c8d9eafb5",
    title: "Hello morethan-log",
    slug: "hello-morethan-log",
    summary: "The first post.",
    date: "2023-11-02",
    tags: ["intro"],
    category: "Life",
    status: "Public",
    type: "Post",
    createdTime: Date.UTC(2023, 10, 2, 12, 0),
  },
  {
    id: "6aafcf84-e293-4b70-d4bd-7c8d9eafb0c6",
    title: "Draft: unpublished notes",
    slug: "unpublished-notes",
    summary: "Never shown on the feed.",
    date: "2024-02-14",
    tags: [],
    category: null,
    status: "Private",
    type: "Post",
    createdTime: Date.UTC(2024, 1, 14, 8, 0),
  },
];

const schema = {
  title: { name: "title", type: "title" },
  slug: { name: "slug", type: "text" },
  summary: { name: "summary", type: "text" },
  date: { name: "date", type: "date" },
  tags: { name: "tags", type: "multi_select" },
  category: { name: "category", type: "select" },
  status: { name: "status", type: "select" },
  type: { name: "type", type: "select" },
};

const text = (value: string): string[][] => [[value]];
const dateProperty = (startDate: string): unknown[] => [
  ["‣", [["d", { type: "date", start_date: startDate }]]],
];

const rowBlock = (post: PostRow): Record<string, unknown> => ({
  id: post.id,
  version: 1,
  type: "page",
  properties: {
    title: text(post.title),
    slug: text(post.slug),
    summary: text(post.summary),
    date: dateProperty(post.date),
    ...(post.tags.length > 0 ? { tags: text(post.tags.join(",")) } : {}),
    ...(post.category ? { category: text(post.category) } : {}),
    status: text(post.status),
    type: text(post.type),
  },
  format: { page_full_width: false },
  created_time: post.createdTime,
  last_edited_time: post.createdTime,
  parent_id: collectionId,
  parent_table: "collection",
  alive: true,
  space_id: spaceId,
});

const withRole = (value: Record<string, unknown>): Record<string, unknown> => ({
  role: "reader",
  value,
});

const rootBlock = withRole({
  id: rootId,
  version: 1,
  type: "collection_view_page",
  view_ids: [viewId],
  collection_id: collectionId,
  format: { collection_pointer: { id: collectionId, table: "collection", spaceId } },
  created_time: Date.UTC(2023, 10, 1),
  last_edited_time: Date.UTC(2024, 2, 12),
  parent_id: spaceId,
  parent_table: "space",
  alive: true,
  space_id: spaceId,
});

const collection = withRole({
  id: collectionId,
  version: 1,
  name: text("Posts"),
  schema,
  parent_id: rootId,
  parent_table: "block",
  alive: true,
});

const collectionView = withRole({
  id: viewId,
  version: 1,
  type: "table",
  name: "All posts",
  format: {},
  parent_id: rootId,
  parent_table: "block",
  alive: true,
});

const pageRecordMap = {
  block: { [rootId]: rootBlock },
  collection: { [collectionId]: collection },
  collection_view: { [viewId]: collectionView },
  notion_user: {},
  space: {},
};

const collectionResponse = {
  result: {
    type: "reducer",
    reducerResults: {
      collection_group_results: {
        type: "results",
        blockIds: posts.map((post) => post.id),
        hasMore: false,
      },
    },
  },
  recordMap: {
    block: Object.fromEntries(posts.map((post) => [post.id, withRole(rowBlock(post))])),
    collection: { [collectionId]: collection },
    collection_view: { [viewId]: collectionView },
    notion_user: {},
  },
};

const responses: Record<string, unknown> = {
  "/api/v3/loadPageChunk": { recordMap: pageRecordMap, cursor: { stack: [] } },
  "/api/v3/queryCollection": collectionResponse,
  "/api/v3/syncRecordValues": { recordMap: { block: {} } },
  "/api/v3/getRecordValues": { recordMapWithRoles: { notion_user: {} } },
  "/api/v3/getSignedFileUrls": { signedUrls: [] },
};

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const handle = (request: IncomingMessage, response: ServerResponse): void => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const body = responses[url.pathname];
  if (body === undefined) return sendJson(response, 404, { message: "Not found" });
  request.resume();
  request.on("end", () => sendJson(response, 200, body));
};

createServer(handle).listen(port, () => {
  console.log(`notion api server listening on http://localhost:${port} (page ${rootId})`);
});
