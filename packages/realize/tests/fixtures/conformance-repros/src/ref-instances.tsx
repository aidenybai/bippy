import { useRef, useState } from "react";

class Notifier {
  constructor(private readonly notify: (isOn: boolean) => void) {}

  send(isOn: boolean) {
    this.notify(!isOn);
  }
}

class ArrowNotifier {
  constructor(private readonly notify: (isOn: boolean) => void) {}

  send = (isOn: boolean) => this.notify(!isOn);
}

export const InitialRefInstance = () => {
  const [isOn, setIsOn] = useState(false);
  const notifier = useRef(new Notifier(setIsOn));
  return <button onClick={() => notifier.current.send(isOn)}>{isOn ? "on" : "off"}</button>;
};

export const LazyRefInstance = () => {
  const [isOn, setIsOn] = useState(false);
  const notifier = useRef<Notifier | null>(null);
  if (!notifier.current) notifier.current = new Notifier(setIsOn);
  return <button onClick={() => notifier.current?.send(isOn)}>{isOn ? "on" : "off"}</button>;
};

export const LazyRefArrowInstance = () => {
  const [isOn, setIsOn] = useState(false);
  const notifier = useRef<ArrowNotifier | null>(null);
  if (!notifier.current) notifier.current = new ArrowNotifier(setIsOn);
  return <button onClick={() => notifier.current?.send(isOn)}>{isOn ? "on" : "off"}</button>;
};
