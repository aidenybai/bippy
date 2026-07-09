"use client";

import { useState } from "react";

export const HmrTarget = () => {
  // getSource captures a component's definition site by invoking it under a
  // null dispatcher and sampling the throw; hook-less, prop-less components
  // never throw, so this hook keeps the fixture symbolicable
  useState(0);
  return <div data-testid="hmr-target">hmr-marker-a</div>;
};
