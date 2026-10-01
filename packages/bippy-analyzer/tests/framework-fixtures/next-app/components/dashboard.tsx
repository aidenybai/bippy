"use client";

import dynamic from "next/dynamic";

const Chart = dynamic(() => import("./chart"));
const ClientChart = dynamic(() => import("./chart"), {
  ssr: false,
  loading: () => <p>Loading</p>,
});

export const Dashboard = () => (
  <div>
    <Chart label="server" />
    <ClientChart label="client" />
  </div>
);
