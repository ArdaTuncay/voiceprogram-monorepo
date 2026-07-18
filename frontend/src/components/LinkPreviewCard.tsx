import { useLinkPreview } from '../hooks/useLinkPreview';
import './LinkPreviewCard.css';

interface Props {
  url: string;
}

export default function LinkPreviewCard({ url }: Props) {
  const preview = useLinkPreview(url);

  if (!preview || (!preview.title && !preview.description && !preview.image)) return null;

  return (
    <a className="link-preview-card" href={url} target="_blank" rel="noopener noreferrer">
      <div className="link-preview-accent" />
      <div className="link-preview-body">
        {preview.site_name && <div className="link-preview-site">{preview.site_name}</div>}
        {preview.title && <div className="link-preview-title">{preview.title}</div>}
        {preview.description && <div className="link-preview-description">{preview.description}</div>}
      </div>
      {preview.image && <img className="link-preview-image" src={preview.image} alt="" />}
    </a>
  );
}
