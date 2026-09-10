import classNames from "classnames";
import { clsx } from "clsx";
import { format, parseISO } from "date-fns";
import fs from "fs";
import { flattenDeep, isEqual, isNil } from "lodash-es";
import isEmpty from "lodash-es/isEmpty";
import { matchSorter } from "match-sorter";
import numeral from "numeral";
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

/** admin-one-react-tailwind's NumberDynamic: the project's own numeral formats a known number through a Numeral instance. */
const FormattedNumber = ({ value }: { value: number }) => (
  <data value={value}>
    <Shown value={value < 1000 ? String(value) : numeral(value).format("0,0")} />
    <Shown value={numeral(value / 1000).format("0.0a")} />
  </data>
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

const BOARD_SIZE = 3;

/** 2048-in-react's board: rows are assigned past the end of an empty array, then one cell is filled. */
const createBoard = (): Array<Array<string | undefined>> => {
  const board: Array<Array<string | undefined>> = [];
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    board[index] = Array.from({ length: BOARD_SIZE }, () => undefined);
  }
  return board;
};

const Board = () => {
  const board = createBoard();
  board[1][2] = "tile";
  const occupied = flattenDeep(board).filter((cell) => !isNil(cell));
  return (
    <table>
      <tbody>
        {board.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{isNil(cell) ? <em>empty</em> : <strong>{cell}</strong>}</td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>
            <Shown value={String(occupied.length)} />
            {isEqual(board[1], [undefined, undefined, "tile"]) && <b>row matches</b>}
            {isEmpty(occupied) ? <i>no tiles</i> : <i>{occupied.length} tiles</i>}
          </td>
        </tr>
      </tfoot>
    </table>
  );
};

interface RouteItem {
  label: string;
  keywords?: string[];
  items?: RouteItem[];
}

const ROUTES: RouteItem[] = [
  {
    label: "Getting Started",
    items: [{ label: "Install" }, { label: "Usage", keywords: ["api"] }],
  },
  { label: "Guides", items: [{ label: "Sorting" }] },
];

/** material-react-table's sidebar: every route ranks for an empty query, so the filtered list is the whole list. */
const filterRoutes = (routes: RouteItem[], search: string): RouteItem[] =>
  routes.reduce((matched: RouteItem[], route) => {
    const matchKeys = ["label"];
    if (route.keywords) matchKeys.push("keywords");
    if (matchSorter([route], search, { keys: matchKeys }).length > 0) {
      matched.push(route);
    } else {
      const items = route.items ? filterRoutes(route.items, search) : undefined;
      if (items?.length) matched.push({ ...route, items });
    }
    return matched;
  }, []);

const RouteList = ({ routes }: { routes: RouteItem[] }) => (
  <ul>
    {routes.map(({ label, items }) => (
      <li key={label}>
        <Shown value={label} />
        {items && <RouteList routes={items} />}
      </li>
    ))}
  </ul>
);

const SearchableRoutes = ({ search }: { search: string }) => {
  const filtered = filterRoutes(ROUTES, search);
  return filtered.length === 0 ? <em>No results for {search}</em> : <RouteList routes={filtered} />;
};

export default function PurePackages() {
  return (
    <section>
      <DateLabel dateString="2020-03-16T05:35:07.322Z" />
      <Shown value={ROLLED_OVER} />
      <ClassNames isActive />
      <ClassNames isActive={false} />
      <FormattedNumber value={512} />
      <FormattedNumber value={7770} />
      <ProjectFiles />
      <Board />
      <SearchableRoutes search="" />
      <SearchableRoutes search="api" />
      <SearchableRoutes search="missing" />
    </section>
  );
}
