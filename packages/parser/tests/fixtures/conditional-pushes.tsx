import type { ReactNode } from "react";

interface Notice {
  id: string;
  level: "info" | "warning";
}

const Toolbar = ({ canEdit, canDelete }: { canEdit: boolean; canDelete: boolean }) => {
  const actions: ReactNode[] = [<button key="view">view</button>];
  if (canEdit) actions.push(<button key="edit">edit</button>);
  if (canDelete) {
    actions.push(<button key="delete">delete</button>);
  }
  return <nav>{actions}</nav>;
};

const Notices = ({ notices }: { notices: Notice[] }) => {
  const rows: ReactNode[] = [];
  for (const notice of notices) {
    if (notice.level === "warning") rows.push(<strong key={notice.id}>{notice.id}</strong>);
    else rows.push(<span key={notice.id}>{notice.id}</span>);
  }
  return <div>{rows}</div>;
};

const Slots = ({ showFooter }: { showFooter: boolean }) => {
  const slots: { header: ReactNode; footer: ReactNode } = { header: <h4>header</h4>, footer: null };
  if (showFooter) slots.footer = <footer>footer</footer>;
  return (
    <article>
      {slots.header}
      <p>body</p>
      {slots.footer}
    </article>
  );
};

const Grid = () => {
  const cells: ReactNode[] = [];
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 2; column++) {
      cells.push(
        <td key={`${row}-${column}`}>
          {row}:{column}
        </td>,
      );
    }
  }
  return (
    <table>
      <tbody>
        <tr>{cells}</tr>
      </tbody>
    </table>
  );
};

const Classes = ({ isActive }: { isActive: boolean }) => {
  const classNames = ["item"];
  if (isActive) classNames.push("active");
  return <li className={classNames.join(" ")}>item</li>;
};

export default function ConditionalPushes() {
  return (
    <div>
      <Toolbar canEdit canDelete={false} />
      <Notices
        notices={[
          { id: "a", level: "info" },
          { id: "b", level: "warning" },
        ]}
      />
      <Slots showFooter />
      <Slots showFooter={false} />
      <Grid />
      <Classes isActive />
    </div>
  );
}
