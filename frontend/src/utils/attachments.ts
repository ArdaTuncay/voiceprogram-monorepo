/** What the composer's file picker offers — the same list Backend.Uploads
 * accepts. Extensions rather than MIME types, since browsers report types
 * for archives inconsistently (the server decides by extension and content
 * anyway). */
export const ATTACHMENT_ACCEPT = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.txt',
  '.zip',
  '.7z',
  '.rar',
  '.docx',
  '.xlsx',
  '.pptx',
].join(',');

/** "512 B", "2,0 KB", "5,5 MB" — Turkish decimal comma. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace('.', ',')} KB`;
  return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** The name an attachment card shows: the original file name, or — for
 * files sent before names were kept — "Dosya (PDF)" from the stored URL. */
export function attachmentLabel(fileUrl: string, fileName: string | null | undefined): string {
  if (fileName) return fileName;
  const match = /\.([a-z0-9]+)$/i.exec(fileUrl);
  return match ? `Dosya (${match[1].toUpperCase()})` : 'Dosya';
}
