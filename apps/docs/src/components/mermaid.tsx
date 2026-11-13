'use client';

import { useEffect, useId, useState } from 'react';

/** A Mermaid diagram, drawn in the browser in the site's dark palette. */
export const Mermaid = ({ chart, title }: { chart: string; title: string }) => {
  const id = useId().replace(/:/g, '');
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        fontFamily: 'var(--font-hanken), sans-serif',
        theme: 'base',
        themeVariables: {
          darkMode: true,
          background: '#070707',
          primaryColor: '#151515',
          primaryTextColor: '#f2f2f2',
          primaryBorderColor: '#3a3a3a',
          secondaryColor: '#0e0e0e',
          tertiaryColor: '#0e0e0e',
          lineColor: '#898989',
          textColor: '#b7b7b7',
          clusterBkg: '#0e0e0e',
          clusterBorder: '#262626',
          edgeLabelBackground: '#070707',
          fontSize: '14px',
        },
      });
      const { svg: rendered } = await mermaid.render(`mermaid-${id}`, chart.trim());
      if (!cancelled) setSvg(rendered);
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  return (
    <figure className="not-prose my-6 overflow-x-auto rounded-xl border bg-fd-card p-4">
      <div
        role="img"
        aria-label={title}
        className="flex min-h-40 items-center justify-center [&_svg]:h-auto [&_svg]:max-h-[520px] [&_svg]:max-w-full"
        // Mermaid output with securityLevel 'strict' from charts written in this repo.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="mt-3 text-center text-xs text-fd-muted-foreground">{title}</figcaption>
    </figure>
  );
};
