import type { ReactNode } from 'react';

const URL_REGEX = /https?:\/\/[^\s<]+/;

// Order matters: code blocks and inline code are tried before bold/italic so
// markdown-looking characters inside code render literally, and bold (**) is
// tried before italic (*) so "**x**" isn't misread as two italic markers.
// Only top-level (non-nested) formatting is supported — a URL inside
// **bold** won't become clickable, for instance — a deliberate simplicity
// tradeoff for a "basic" formatter rather than a full recursive parser.
const TOKEN_REGEX =
  /```(?:([a-zA-Z0-9_+-]+)\n)?([\s\S]*?)```|`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|(https?:\/\/[^\s<]+)/g;

/** Strips trailing punctuation a URL likely picked up from surrounding prose (e.g. "see https://x.com." → "https://x.com"). */
function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,!?;:'")\]]+$/, '');
}

/** First URL in `content`, if any — used to decide whether to fetch a link-preview card. */
export function extractFirstUrl(content: string): string | null {
  const match = content.match(URL_REGEX);
  return match ? trimTrailingPunctuation(match[0]) : null;
}

/** Renders a message's content with basic markdown (bold/italic/inline code/code blocks) and clickable links, as plain React nodes — never dangerouslySetInnerHTML, so there's no HTML-injection surface to sanitize. */
export function renderRichText(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(TOKEN_REGEX)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(content.slice(lastIndex, index));

    const [full, codeLang, codeBlock, inlineCode, bold, italic, url] = match;
    const key = `token-${index}`;

    if (codeBlock !== undefined) {
      const body = codeBlock.replace(/^\n/, '').replace(/\n$/, '');
      nodes.push(
        <pre className="message-code-block" key={key}>
          {codeLang && <div className="message-code-lang">{codeLang}</div>}
          <code>{body}</code>
        </pre>
      );
    } else if (inlineCode !== undefined) {
      nodes.push(
        <code className="message-inline-code" key={key}>
          {inlineCode}
        </code>
      );
    } else if (bold !== undefined) {
      nodes.push(<strong key={key}>{bold}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={key}>{italic}</em>);
    } else if (url !== undefined) {
      const trimmed = trimTrailingPunctuation(url);
      const trailing = url.slice(trimmed.length);
      nodes.push(
        <a key={key} href={trimmed} target="_blank" rel="noopener noreferrer" className="message-link">
          {trimmed}
        </a>
      );
      if (trailing) nodes.push(trailing);
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < content.length) nodes.push(content.slice(lastIndex));

  return nodes;
}
