import { useState } from "react";

export const SelectedChat = ({ chatId }: { chatId: string | null }) => {
  const [lastChatId, setLastChatId] = useState<string | null>(null);
  if (chatId && chatId !== lastChatId) setLastChatId(chatId);
  return <p>{lastChatId === null ? "No chat" : "Chat selected"}</p>;
};
