/** The WHATWG `URL` setters normalize their input and stay live-linked with `searchParams`. */
const normalize = (input: string): string => {
  const url = new URL(input.replace(/^\/\//, "http://"));
  url.username = "";
  url.password = "";
  url.hash = url.hash.replace(/#?:~:text.*?$/i, "");
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  url.hostname = url.hostname.replace(/^www\./, "");
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.search = decodeURIComponent(url.search);
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
};

const stripped = new URL("https://www.example.com/docs?b=2&a=1");
stripped.search = "";
stripped.port = "8443";
stripped.protocol = "http";

const rehosted = new URL("https://example.com/a");
rehosted.host = "api.example.org:9000";
rehosted.hostname = "not a host";

const relinked = new URL("https://example.com/?keep=1");
relinked.href = "https://other.test/path?x=1&y=2#frag";
relinked.searchParams.append("z", "3");

const invalidHref = (): string => {
  const url = new URL("https://example.com/");
  try {
    url.href = "not a url";
    return url.href;
  } catch (error) {
    return error instanceof TypeError ? `TypeError:${url.href}` : "other";
  }
};

export default function UrlSetters() {
  return (
    <ul>
      <li>{normalize("//user:pw@www.notion.so//image/a%2Fb/?utm_source=x&id=1&table=block#:~:text=a")}</li>
      <li>{normalize("https://www.example.com/path/")}</li>
      <li>
        {stripped.href}|{stripped.searchParams.size}|{stripped.origin}
      </li>
      <li>
        {rehosted.href}|{rehosted.hostname}|{rehosted.port}
      </li>
      <li>
        {relinked.href}|{relinked.search}|{relinked.searchParams.get("keep") ?? "none"}
      </li>
      <li>{invalidHref()}</li>
    </ul>
  );
}
