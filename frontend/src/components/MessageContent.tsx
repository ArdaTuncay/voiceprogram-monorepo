import { renderRichText, extractFirstUrl } from '../richText';
import LinkPreviewCard from './LinkPreviewCard';

interface Props {
  content: string;
}

/** Shared by Chat.tsx and DMChatView.tsx — renders a message's text with
 * basic markdown + clickable links, plus a link-preview card underneath if
 * the content contains a URL. */
export default function MessageContent({ content }: Props) {
  const previewUrl = extractFirstUrl(content);

  return (
    <>
      <div className="message-content">{renderRichText(content)}</div>
      {previewUrl && <LinkPreviewCard url={previewUrl} />}
    </>
  );
}
