import classNames from "classnames";
import { clsx } from "clsx";
import { format, parseISO } from "date-fns";
import fs from "fs";
import { basename, join } from "path";
import { twMerge } from "tailwind-merge";

interface DateLabelProps {
  dateString: string;
}

/** Two text children become two HostText fibers, so the comparer checks the computed value. */
const Shown = ({ value }: { value: string }) => (
  <code>
    {"= "}
    {value}
  </code>
);

/** nextjs-examples' DateFormatter: the project's own date-fns formats a known ISO string. */
const DateLabel = ({ dateString }: DateLabelProps) => {
  const date = parseISO(dateString);
  return (
    <time dateTime={dateString}>
      <Shown value={format(date, "LLLL d, yyyy")} />
    </time>
  );
};

const LEAP_DAY = new Date("2024-02-29T12:00:00Z");
LEAP_DAY.setUTCFullYear(2025);
const ROLLED_OVER = `${LEAP_DAY.getUTCMonth()}/${LEAP_DAY.getUTCDate()} ${LEAP_DAY.toISOString()}`;

const ClassNames = ({ isActive }: { isActive: boolean }) => (
  <>
    <Shown value={clsx("chip", { active: isActive, hidden: !isActive })} />
    <Shown value={classNames("chip", ["a", "b"], { active: isActive })} />
    <Shown value={twMerge("px-2 py-1", "px-4")} />
  </>
);

const PROJECT_FILES = fs.readdirSync(process.cwd());

const readCompilerOptions = (): Record<string, unknown> => {
  const configPath = join(process.cwd(), "tsconfig.json");
  if (!fs.existsSync(configPath)) return {};
  const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return typeof parsed === "object" && parsed !== null && "compilerOptions" in parsed
    ? (parsed.compilerOptions as Record<string, unknown>)
    : {};
};

const ProjectFiles = () => {
  const compilerOptions = readCompilerOptions();
  const configNames = PROJECT_FILES.filter((name) => name.startsWith("tsconfig")).map((name) =>
    basename(name, ".json"),
  );
  return (
    <ul>
      {configNames.map((name) => (
        <li key={name}>
          <Shown value={name} />
        </li>
      ))}
      <li>jsx: {String(compilerOptions.jsx)}</li>
      {compilerOptions.strict === true && <li>strict</li>}
    </ul>
  );
};

export default function PurePackages() {
  return (
    <section>
      <DateLabel dateString="2020-03-16T05:35:07.322Z" />
      <Shown value={ROLLED_OVER} />
      <ClassNames isActive />
      <ClassNames isActive={false} />
      <ProjectFiles />
    </section>
  );
}
