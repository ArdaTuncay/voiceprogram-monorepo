import { Fragment } from 'react';
import type { ReactNode } from 'react';

/**
 * Fills a translated string's `{name}` placeholders with React nodes, for
 * text with markup in the middle whose position differs by language:
 * `rich(t('{server} sunucusundan ayrıl'), { server: <strong>{name}</strong> })`.
 */
export function rich(text: string, values: Record<string, ReactNode>): ReactNode {
  const parts = text.split(/(\{\w+\})/);
  return parts.map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{name !== undefined && name in values ? values[name] : part}</Fragment>;
  });
}
