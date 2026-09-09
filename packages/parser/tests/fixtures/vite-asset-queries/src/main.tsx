import { createRoot } from "react-dom/client";
import iconInline from "./icons/dot-icon.svg?inline";
import iconNoInline from "./icons/dot-icon.svg?no-inline";
import iconUrl from "./icons/dot-icon.svg?url";
import releaseNotesUrl from "./release-notes.txt?url";

const urls = { iconUrl, iconInline, iconNoInline, releaseNotesUrl };

// The comparer checks keys, not host attributes, so the URL goes into the key.
const App = () => (
  <ul>
    {Object.entries(urls).map(([name, url]) => (
      <li key={`${name}=${url}`}>{name}</li>
    ))}
  </ul>
);

createRoot(document.getElementById("root")!).render(<App />);
