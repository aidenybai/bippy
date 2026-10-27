import { useEffect } from "react";

export default function DefaultAnnouncer({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, []);
  return <b>child</b>;
}
