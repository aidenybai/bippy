import { debounce, throttle } from "lodash-es";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useState,
  type PropsWithChildren,
} from "react";

interface BoardState {
  moves: number;
  notes: string[];
}

interface MoveAction {
  type: "move";
}

interface NoteAction {
  type: "note";
  text: string;
}

const boardReducer = (state: BoardState, action: MoveAction | NoteAction): BoardState =>
  action.type === "move"
    ? { ...state, moves: state.moves + 1 }
    : { ...state, notes: [...state.notes, action.text] };

const BoardContext = createContext({
  moves: 0,
  notes: [] as string[],
  note: (_text: string) => {},
});

/** 2048-in-react's GameProvider: a throttled dispatcher is created every render and handed to a keyboard handler. */
const BoardProvider = ({ children }: PropsWithChildren) => {
  const [state, dispatch] = useReducer(boardReducer, { moves: 0, notes: [] });
  const note = useCallback(
    throttle((text: string) => dispatch({ type: "note", text }), 100, { trailing: false }),
    [dispatch],
  );
  useEffect(() => {
    dispatch({ type: "move" });
    dispatch({ type: "move" });
  }, []);
  return (
    <BoardContext.Provider value={{ moves: state.moves, notes: state.notes, note }}>
      {children}
    </BoardContext.Provider>
  );
};

const Keyboard = () => {
  const { note } = useContext(BoardContext);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => note(event.key);
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [note]);
  return null;
};

const Moves = () => {
  const { moves, notes } = useContext(BoardContext);
  return (
    <ul>
      <li>{moves} moves</li>
      {notes.map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ul>
  );
};

/** `leading: true` invokes the wrapped setter synchronously on the first call. */
const LeadingEdge = () => {
  const [label, setLabel] = useState("idle");
  useEffect(() => {
    const announce = debounce((next: string) => setLabel(next), 50, { leading: true });
    announce("ready");
  }, []);
  return (
    <p>
      {"state: "}
      {label}
    </p>
  );
};

/** Without `leading`, `debounce` only fires from its timer, so the setter escapes the render. */
const TrailingEdge = () => {
  const [label, setLabel] = useState("pending");
  useEffect(() => {
    const settle = debounce((next: string) => setLabel(next), 10);
    settle("settled");
  }, []);
  return (
    <em>
      {"state: "}
      {label}
    </em>
  );
};

export default function LodashWrappers() {
  return (
    <section>
      <BoardProvider>
        <Keyboard />
        <Moves />
      </BoardProvider>
      <LeadingEdge />
      <TrailingEdge />
    </section>
  );
}

export const minCoverage = 0.9;
