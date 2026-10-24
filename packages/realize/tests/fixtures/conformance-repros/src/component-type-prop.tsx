import type { ComponentType } from "react";

interface Project {
  name: string;
  icon: ComponentType<{ className?: string }>;
}

export const ProjectLabel = ({ project }: { project: Project }) => (
  <span>
    <project.icon className="size-4" />
    {project.name}
  </span>
);
