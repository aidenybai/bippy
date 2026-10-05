import Badge from "./shared/anonymous-badge";
import Counter from "./shared/anonymous-counter";
import Link from "./shared/anonymous-link";
import Note from "./shared/anonymous-note";

// The importer's local name never names an export: an anonymous function or
// class written in `export default` is `default`, and whatever `forwardRef` or
// `styled()` returns keeps the name those calls gave it.
export default function DefaultExportNames() {
  return (
    <div>
      <Badge label="badge" />
      <Counter start={1} />
      <Link href="/docs">docs</Link>
      <Note>note</Note>
    </div>
  );
}
