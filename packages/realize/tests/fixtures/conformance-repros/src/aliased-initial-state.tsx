import { useState } from "react";

const inbox = {
  mails: [
    { id: 1, subject: "Welcome" },
    { id: 2, subject: "Invoice" },
    { id: 3, subject: "Reminder" },
  ],
};

export const ReversedInbox = () => {
  const [mails, setMails] = useState(inbox.mails);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const reversed = inbox.mails.reverse();
          setMails(reversed.slice(0, 2));
        }}
      >
        Reverse
      </button>
      {mails.map((mail) => (
        <p key={mail.id}>{mail.subject}</p>
      ))}
    </div>
  );
};

const inboxArchive = { mails: [{ id: 4, subject: "Archived" }] };

export const ReversedArchive = () => {
  const [mails, setMails] = useState(inbox.mails);
  return (
    <button type="button" onClick={() => setMails(inboxArchive.mails.reverse().slice(0, 1))}>
      {mails.length}
    </button>
  );
};
