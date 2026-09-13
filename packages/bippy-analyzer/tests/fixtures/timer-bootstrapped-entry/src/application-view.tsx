interface ApplicationViewProps {
  server: string;
  device: { platform: string; version: string };
}

export const ApplicationView = ({ server, device }: ApplicationViewProps) => (
  <main>
    <h1>{device.platform}</h1>
    <p>{server}</p>
    <small>{device.version}</small>
  </main>
);
