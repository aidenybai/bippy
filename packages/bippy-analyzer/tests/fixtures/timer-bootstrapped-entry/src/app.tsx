import { createRoot } from "react-dom/client";
import { ApplicationView } from "./application-view";

interface Device {
  platform: string;
  version: string;
}

const APP_VERSION = "3.202.4";

const createDevice = async (): Promise<Device> => {
  await Promise.resolve();
  return { platform: "web", version: APP_VERSION };
};

const startApplication = async (server: string): Promise<void> => {
  const device = await createDevice();
  const rootNode =
    document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
  const root = createRoot(rootNode);
  root.render(<ApplicationView server={server} device={device} />);
};

setTimeout(() => {
  startApplication("https://sync.example").catch(console.error);
}, 0);
