import themeCss from "./shared/theme.css?inline";
import releaseNotes from "./shared/release-notes.txt?raw";

const lineCount = releaseNotes.trim().split("\n").length;

export default function AssetImports() {
  return (
    <div>
      <style>{themeCss}</style>
      <pre>{releaseNotes}</pre>
      <p>{lineCount} lines</p>
      <span>{themeCss.includes("--color-text") ? "themed" : "plain"}</span>
    </div>
  );
}
