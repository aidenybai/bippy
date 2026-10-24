import { useMemo } from "react";

interface Message {
  role: "user" | "assistant";
  text: string;
}

export const LoopMemo = ({ messages }: { messages: Message[] }) => {
  const lastText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].text;
    }
    return null;
  }, [messages]);
  return <div>{lastText ? <p>{lastText}</p> : <i>none</i>}</div>;
};

export const TwoLoopMemos = ({ messages }: { messages: Message[] }) => {
  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].text;
    }
    return null;
  }, [messages]);
  const lastUser = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].text;
    }
    return null;
  }, [messages]);
  return (
    <div>
      {lastAssistant ? <p>{lastAssistant}</p> : <i>none</i>}
      {lastUser ? <b>{lastUser}</b> : <i>nobody</i>}
    </div>
  );
};

export const LoopWithStateTest = ({
  messages,
  showAll,
}: {
  messages: Message[];
  showAll: boolean;
}) => {
  const found = useMemo(() => {
    for (const message of messages) {
      if (showAll) return message.text;
      if (message.role === "assistant") return message.text;
    }
    return null;
  }, [messages, showAll]);
  return <div>{found ? <p>{found}</p> : <i>none</i>}</div>;
};
