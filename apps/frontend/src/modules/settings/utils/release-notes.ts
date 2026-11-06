/**
 * A small Markdown reader for GitHub release notes: headings, paragraphs,
 * bullet and numbered lists, fenced code, bold, inline code and links. It
 * builds a tree that React renders as elements, so release text is never
 * injected as HTML.
 */

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

export type BlockNode =
  | { type: 'heading'; level: number; content: InlineNode[] }
  | { type: 'paragraph'; content: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'code'; text: string };

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

// `code`, **bold**, [label](url) or a bare https URL, whichever comes first.
const INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

export const parseInline = (text: string): InlineNode[] => {
  const nodes: InlineNode[] = [];
  let last = 0;

  const pushText = (value: string) => {
    if (!value) {
      return;
    }

    const previous = nodes.at(-1);

    if (previous?.type === 'text') {
      previous.text += value;
    } else {
      nodes.push({ type: 'text', text: value });
    }
  };

  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    pushText(text.slice(last, index));
    last = index + match[0].length;

    const [, code, bold, underscoreBold, label, href, bare] = match;

    if (code !== undefined) {
      nodes.push({ type: 'code', text: code });
    } else if (bold !== undefined || underscoreBold !== undefined) {
      nodes.push({ type: 'strong', text: bold ?? underscoreBold });
    } else if (label !== undefined && href !== undefined) {
      if (SAFE_URL.test(href)) {
        nodes.push({ type: 'link', text: label, href });
      } else {
        pushText(label);
      }
    } else if (bare !== undefined) {
      nodes.push({ type: 'link', text: shortenUrl(bare), href: bare });
    }
  }

  pushText(text.slice(last));
  return nodes;
};

/**
 * A GitHub compare or pull request URL as GitHub shows it
 * (`v0.1.5...v0.1.6`, `#42`); other URLs stay as they are.
 */
export const shortenUrl = (url: string): string => {
  const compare = /github\.com\/[^/]+\/[^/]+\/compare\/([^?#]+)/.exec(url);

  if (compare) {
    return compare[1];
  }

  const pull = /github\.com\/[^/]+\/[^/]+\/(?:pull|issues)\/(\d+)/.exec(url);
  return pull ? `#${pull[1]}` : url;
};

const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;

export const parseReleaseNotes = (markdown: string): BlockNode[] => {
  const blocks: BlockNode[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({
        type: 'paragraph',
        content: parseInline(paragraph.join(' ')),
      });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list) {
      blocks.push({
        type: 'list',
        ordered: list.ordered,
        items: list.items.map(parseInline),
      });
      list = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushList();
      const code: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }

      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    if (!trimmed || /^(-{3,}|\*{3,}|<!--.*-->)$/.test(trimmed)) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(trimmed);

    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        content: parseInline(heading[2]),
      });
      continue;
    }

    const item = LIST_ITEM.exec(line);

    if (item) {
      flushParagraph();
      const ordered = item[2] !== undefined;

      if (list && list.ordered !== ordered) {
        flushList();
      }

      list ??= { ordered, items: [] };
      list.items.push(item[3]);
      continue;
    }

    if (list && /^\s{2,}\S/.test(line)) {
      // A wrapped list item.
      list.items[list.items.length - 1] += ` ${trimmed}`;
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
};
