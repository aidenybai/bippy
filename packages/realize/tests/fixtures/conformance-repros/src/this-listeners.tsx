import { useEffect, useRef, useState } from "react";

export function MuteToggle() {
  const [isMuted, setIsMuted] = useState(false);
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = checkbox.current;
    if (!input) return;
    const onChange = function (this: HTMLInputElement) {
      setIsMuted(this.checked);
    };
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);
  return (
    <label>
      <input type="checkbox" ref={checkbox} />
      {isMuted ? "Muted" : "Sound on"}
    </label>
  );
}

export function ScrollShadow() {
  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    function onScroll(this: Window) {
      setIsScrolled(this.scrollY > 0);
    }
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return <header className={isScrolled ? "shadow" : undefined}>Inbox</header>;
}
