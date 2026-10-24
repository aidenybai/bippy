import { useState } from "react";

interface Modal {
  title: string;
  onConfirm?: () => void;
}

export const ModalFooter = ({ modal }: { modal: Modal }) => {
  const [isClosed, setClosed] = useState(false);
  return (
    <footer>
      {isClosed ? <p>Closed</p> : null}
      {modal.onConfirm && (
        <button
          onClick={() => {
            modal.onConfirm!();
            setClosed(true);
          }}
        >
          {modal.title}
        </button>
      )}
    </footer>
  );
};

declare function send(message: string): void;

export const SendButton = ({ draft }: { draft: string | null }) => {
  const [isSent, setSent] = useState(false);
  return (
    <div>
      {isSent ? <p>Sent</p> : null}
      <button
        disabled={draft === null}
        onClick={() => {
          send(draft!);
          setSent(true);
        }}
      >
        Send
      </button>
    </div>
  );
};

export const ConfirmLink = ({ modal }: { modal: Modal }) => {
  const [isClosed, setClosed] = useState(false);
  const confirm = () => {
    modal.onConfirm!();
    setClosed(true);
  };
  return (
    <footer>
      {isClosed ? <p>Closed</p> : null}
      {modal.onConfirm ? <button onClick={() => confirm()}>{modal.title}</button> : null}
    </footer>
  );
};

export const SharedConfirm = ({ modal }: { modal: Modal }) => {
  const [isClosed, setClosed] = useState(false);
  const confirm = () => {
    modal.onConfirm!();
    setClosed(true);
  };
  return (
    <footer>
      {isClosed ? <p>Closed</p> : null}
      {modal.onConfirm && <button onClick={confirm}>Confirm</button>}
      <button onClick={confirm}>Force</button>
    </footer>
  );
};

export const MappedConfirms = ({ modals }: { modals: Modal[] }) => (
  <ul>
    {modals.map(
      (modal) =>
        modal.onConfirm && (
          <li key={modal.title}>
            <button onClick={() => modal.onConfirm!()}>{modal.title}</button>
          </li>
        ),
    )}
  </ul>
);

export const MappedReturns = ({ modals }: { modals: Modal[] }) => (
  <ul>
    {modals.map((modal) => {
      if (!modal.onConfirm) return null;
      return (
        <li key={modal.title}>
          <button onClick={() => modal.onConfirm!()}>{modal.title}</button>
        </li>
      );
    })}
  </ul>
);
