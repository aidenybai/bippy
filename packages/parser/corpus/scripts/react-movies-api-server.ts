// Stands in for the two remote services the JS Mastery movie app reads on
// mount: TMDB's `/3/discover/movie` and `/3/search/movie` (`{ results }`) and
// an Appwrite project's `/v1/databases/{db}/collections/{col}/documents`
// (`{ total, documents }`, the "trending" search log). The Appwrite web SDK
// sends credentialed cross-origin requests, so CORS echoes the origin.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.REACT_MOVIES_API_PORT ?? 5178);

interface TmdbMovie {
  id: number;
  title: string;
  poster_path: string | null;
  vote_average: number;
  release_date: string;
  original_language: string;
}

interface TrendingDocument {
  $id: string;
  searchTerm: string;
  count: number;
  movie_id: number;
  poster_url: string;
}

const movies: TmdbMovie[] = [
  {
    id: 1,
    title: "The Corpus Strikes Back",
    poster_path: "/corpus-1.jpg",
    vote_average: 8.25,
    release_date: "2024-05-01",
    original_language: "en",
  },
  {
    id: 2,
    title: "Fiber Parity",
    poster_path: null,
    vote_average: 0,
    release_date: "",
    original_language: "fr",
  },
  {
    id: 3,
    title: "Static Render",
    poster_path: "/corpus-3.jpg",
    vote_average: 6.5,
    release_date: "2023-11-20",
    original_language: "ja",
  },
];

const trending: TrendingDocument[] = [
  {
    $id: "trend-1",
    searchTerm: "corpus",
    count: 12,
    movie_id: 1,
    poster_url: "https://image.tmdb.org/t/p/w500/corpus-1.jpg",
  },
  {
    $id: "trend-2",
    searchTerm: "parity",
    count: 3,
    movie_id: 3,
    poster_url: "https://image.tmdb.org/t/p/w500/corpus-3.jpg",
  },
];

const sendJson = (
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": request.headers.origin ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": request.headers["access-control-request-headers"] ?? "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  });
  response.end(body === null ? undefined : JSON.stringify(body));
};

const isAppwriteDocuments = (pathname: string): boolean =>
  /^\/v1\/databases\/[^/]+\/collections\/[^/]+\/documents$/.test(pathname);

const handle = (request: IncomingMessage, response: ServerResponse): void => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, null);
    return;
  }
  if (
    request.method === "GET" &&
    (url.pathname === "/3/discover/movie" || url.pathname === "/3/search/movie")
  ) {
    const query = url.searchParams.get("query")?.toLowerCase() ?? "";
    const results = movies.filter((movie) => movie.title.toLowerCase().includes(query));
    sendJson(request, response, 200, {
      page: 1,
      results,
      total_pages: 1,
      total_results: results.length,
    });
    return;
  }
  if (request.method === "GET" && isAppwriteDocuments(url.pathname)) {
    sendJson(request, response, 200, { total: trending.length, documents: trending });
    return;
  }
  if (request.method === "POST" && isAppwriteDocuments(url.pathname)) {
    sendJson(request, response, 201, { $id: `trend-${trending.length + 1}` });
    return;
  }
  sendJson(request, response, 404, {
    message: `Endpoint ${url.pathname} not found`,
    code: 404,
    type: "general_route_not_found",
  });
};

createServer(handle).listen(port, () => {
  console.log(`react-movies stand-in api listening on :${port}`);
});
