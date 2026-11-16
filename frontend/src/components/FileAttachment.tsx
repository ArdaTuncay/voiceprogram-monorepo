import { Download, FileArchive, FileText } from 'lucide-react';
import { resolveFileUrl } from '../config';
import { attachmentLabel, downloadPath, formatFileSize } from '../utils/attachments';

interface Props {
  fileUrl: string;
  fileType: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

const ARCHIVE_TYPES = ['application/zip', 'application/x-7z-compressed', 'application/vnd.rar'];

/** A non-image attachment (PDF, archive, document) in a message: name, size
 * and a download link. The server serves these files as downloads (see
 * BackendWeb.UploadDispositionPlug), so opening the link never renders the
 * file in a page. */
export default function FileAttachment({ fileUrl, fileType, fileName, fileSize }: Props) {
  const label = attachmentLabel(fileUrl, fileName);
  const Icon = fileType && ARCHIVE_TYPES.includes(fileType) ? FileArchive : FileText;

  return (
    <a
      className="message-attachment-file"
      href={resolveFileUrl(downloadPath(fileUrl, fileName))}
      target="_blank"
      rel="noopener noreferrer"
      download={fileName ?? true}
    >
      <Icon size={28} className="message-attachment-file-icon" aria-hidden="true" />
      <span className="message-attachment-file-meta">
        <span className="message-attachment-file-name">{label}</span>
        {typeof fileSize === 'number' && (
          <span className="message-attachment-file-size">{formatFileSize(fileSize)}</span>
        )}
      </span>
      <Download size={18} className="message-attachment-file-download" aria-hidden="true" />
    </a>
  );
}
