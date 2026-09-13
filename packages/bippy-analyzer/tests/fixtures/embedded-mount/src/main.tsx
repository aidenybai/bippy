import { embedDashboard } from "./embed";

const container = document.getElementById("root");
if (container) embedDashboard(container, { title: "Embedded" });
