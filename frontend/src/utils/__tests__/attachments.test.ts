import { describe, expect, it } from 'vitest';
import { ATTACHMENT_ACCEPT, attachmentLabel, formatFileSize } from '../attachments';

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2,0 KB'],
    [1536, '1,5 KB'],
    [5.5 * 1024 * 1024, '5,5 MB'],
  ])('%d bytes → %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

describe('attachmentLabel', () => {
  it('prefers the original file name', () => {
    expect(attachmentLabel('/uploads/x.pdf', 'Ödev.pdf')).toBe('Ödev.pdf');
  });

  it('falls back to the stored extension', () => {
    expect(attachmentLabel('/uploads/x.docx', null)).toBe('Dosya (DOCX)');
    expect(attachmentLabel('https://cdn.example/x', undefined)).toBe('Dosya');
  });
});

describe('ATTACHMENT_ACCEPT', () => {
  it('offers the images and the documents/archives the server accepts', () => {
    for (const ext of ['.png', '.jpg', '.pdf', '.txt', '.zip', '.7z', '.rar', '.docx', '.xlsx', '.pptx']) {
      expect(ATTACHMENT_ACCEPT.split(',')).toContain(ext);
    }
    expect(ATTACHMENT_ACCEPT).not.toContain('.exe');
  });
});
