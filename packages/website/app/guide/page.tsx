import type { Metadata } from "next";

import { GuideEssay } from "@/components/guide/guide-essay";

export const metadata: Metadata = {
  title: "What bippy actually is",
  description:
    "A hands-on guide to React Fiber, the DevTools hook, render instrumentation, and bippy.",
};

const GuidePage = () => <GuideEssay />;

export default GuidePage;
