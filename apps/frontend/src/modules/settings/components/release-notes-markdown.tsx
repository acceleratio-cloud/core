import { Fragment } from 'react';

import { parseReleaseNotes, type InlineNode } from '../utils/release-notes';

const Inline = ({ nodes }: { nodes: InlineNode[] }) => (
  <>
    {nodes.map((node, index) => {
      switch (node.type) {
        case 'strong':
          return (
            <strong key={index} className="font-medium text-foreground">
              {node.text}
            </strong>
          );
        case 'code':
          return (
            <code
              key={index}
              className="rounded-sm bg-surface-muted px-1 py-px font-mono text-[12px] text-foreground"
            >
              {node.text}
            </code>
          );
        case 'link':
          return (
            <a
              key={index}
              href={node.href}
              target="_blank"
              rel="noreferrer"
              className="break-all text-brand-fg underline-offset-4 hover:underline"
            >
              {node.text}
            </a>
          );
        default:
          return <Fragment key={index}>{node.text}</Fragment>;
      }
    })}
  </>
);

/** GitHub release notes as formatted text; nothing is injected as HTML. */
export const ReleaseNotesMarkdown = ({ markdown }: { markdown: string }) => {
  const blocks = parseReleaseNotes(markdown);

  if (blocks.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">No release notes.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <p
                key={index}
                className="mt-1 text-[13px] font-medium text-foreground first:mt-0"
              >
                <Inline nodes={block.content} />
              </p>
            );
          case 'code':
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground"
              >
                {block.text}
              </pre>
            );
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';

            return (
              <List
                key={index}
                className={
                  block.ordered
                    ? 'flex list-decimal flex-col gap-1 pl-5'
                    : 'flex list-disc flex-col gap-1 pl-5 marker:text-fg-tertiary'
                }
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="break-words">
                    <Inline nodes={item} />
                  </li>
                ))}
              </List>
            );
          }
          default:
            return (
              <p key={index} className="break-words">
                <Inline nodes={block.content} />
              </p>
            );
        }
      })}
    </div>
  );
};
