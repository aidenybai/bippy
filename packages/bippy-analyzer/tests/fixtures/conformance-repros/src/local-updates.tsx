export const PostfixLocal = ({ isExtra }: { isExtra: boolean }) => {
  let count = 1;
  if (isExtra) count++;
  return <div>{count > 1 ? <b>many</b> : <i>one</i>}</div>;
};

export const PrefixBothArms = ({ isExtra }: { isExtra: boolean }) => {
  let count = 1;
  if (isExtra) ++count;
  else count--;
  return <div>{count > 1 ? <b>many</b> : <i>one</i>}</div>;
};

export const ChainedIndices = ({ hasTabs, hasChats }: { hasTabs: boolean; hasChats: boolean }) => {
  let nextIndex = 0;
  const tabsIndex = hasTabs ? nextIndex++ : -1;
  const chatsIndex = hasChats ? nextIndex++ : -1;
  return (
    <div>
      {tabsIndex >= 0 && <b>tabs</b>}
      {chatsIndex > 0 && <i>chats</i>}
    </div>
  );
};
