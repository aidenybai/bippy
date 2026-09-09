import { useEffect, useState } from "react";

type ChannelHook = (channel: BroadcastChannel) => void;

const channelHooks = new Set<ChannelHook>();

window.addEventListener("message", (event) => {
  if (typeof event.data === "function") channelHooks.add(event.data);
});

const announceChannel = (channel: BroadcastChannel): void => {
  for (const hook of channelHooks) hook(channel);
};

const publisher = new BroadcastChannel("shared");
announceChannel(publisher);
const idle = new BroadcastChannel("idle");
announceChannel(idle);

const Subscriber = () => {
  const [sharedMessages, setSharedMessages] = useState(0);
  const [idleMessages, setIdleMessages] = useState(0);
  useEffect(() => {
    const shared = new BroadcastChannel("shared");
    shared.onmessage = () => setSharedMessages((count) => count + 1);
    const unrelated = new BroadcastChannel("unrelated");
    unrelated.onmessage = () => setIdleMessages((count) => count + 1);
    return () => {
      shared.close();
      unrelated.close();
    };
  }, []);
  return (
    <dl>
      <dd>{sharedMessages === 0 ? <i>quiet</i> : <b>{sharedMessages}</b>}</dd>
      <dd>{idleMessages === 0 ? <i>quiet</i> : <b>{idleMessages}</b>}</dd>
    </dl>
  );
};

export const isPartial = true;

export default function EscapedBroadcastChannel() {
  return (
    <main>
      <Subscriber />
    </main>
  );
}
