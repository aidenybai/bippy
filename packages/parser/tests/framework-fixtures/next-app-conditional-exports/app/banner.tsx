"use client";
import { isServerBuild, useGreeting } from "greeting-kit";

export const Banner = () => {
  const greeting = useGreeting();
  return <h1 data-server-build={isServerBuild}>Greeting: {greeting}</h1>;
};
