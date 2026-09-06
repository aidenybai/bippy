interface Command {
  name: string;
  description: string;
  shortcut?: string;
}

const COMMANDS: Command[] = [
  { name: "clear", description: "Clear the chat", shortcut: "⌘K" },
  { name: "purge", description: "Delete all chats" },
  { name: "help", description: "Show help", shortcut: "?" },
  { name: "quit", description: "Leave" },
];

/** Statically undecidable, so every kept command is an optional item. */
const isEnabled = (name: string): boolean => name.length > (typeof window === "undefined" ? 99 : 4);

const CommandItem = ({ cmd }: { cmd: Command }) => (
  <button type="button">
    <span>/{cmd.name}</span>
    <span>{cmd.description}</span>
    {cmd.shortcut ? <kbd>{cmd.shortcut}</kbd> : null}
  </button>
);

const Menu = () => {
  const filtered = COMMANDS.filter((cmd) => isEnabled(cmd.name));
  const [first] = filtered;
  return (
    <div>
      {filtered.length === 0 ? <p>none</p> : null}
      <ul>
        {filtered.map((cmd, index) => (
          <li key={cmd.name} data-index={index}>
            <CommandItem cmd={cmd} />
          </li>
        ))}
      </ul>
      <p>{filtered.map((cmd) => cmd.name).join(", ")}</p>
      <em>{first?.name ?? "nothing"}</em>
      <ol>
        {[...filtered.filter((cmd) => cmd.shortcut), { name: "extra", description: "" }].map(
          (cmd) => (
            <li key={cmd.name}>{cmd.name}</li>
          ),
        )}
      </ol>
    </div>
  );
};

export default function FilteredLists() {
  return <Menu />;
}
