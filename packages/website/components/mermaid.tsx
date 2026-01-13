'use client';

import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

interface MermaidProps {
  chart: string;
}

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#1a1a1a',
    primaryTextColor: '#fff',
    primaryBorderColor: '#585858',
    lineColor: '#585858',
    secondaryColor: '#1a1a1a',
    tertiaryColor: '#1a1a1a',
    background: 'transparent',
    mainBkg: '#1a1a1a',
    nodeBorder: '#585858',
    clusterBkg: 'transparent',
    clusterBorder: '#585858',
    titleColor: '#fff',
    edgeLabelBackground: 'transparent',
  },
});

export const Mermaid = ({ chart }: MermaidProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const renderChart = async () => {
      if (!containerRef.current) return;

      const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
      const { svg } = await mermaid.render(id, chart);
      containerRef.current.innerHTML = svg;
    };

    renderChart();
  }, [chart]);

  return (
    <div
      ref={containerRef}
      className="flex justify-center [&_svg]:max-w-full"
    />
  );
};
