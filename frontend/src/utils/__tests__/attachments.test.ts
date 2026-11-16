import { describe, expect, it } from 'vitest';
import { ATTACHMENT_ACCEPT, attachmentLabel, downloadPath, formatFileSize } from '../attachments';

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

describe('downloadPath', () => {
  it('asks the server to name a locally stored file after the original', () => {
    expect(downloadPath('/uploads/abc.pdf', 'Ödev 1.pdf')).toBe('/uploads/abc.pdf?name=%C3%96dev%201.pdf');
  });

  it('leaves links that already carry the name alone', () => {
    expect(downloadPath('https://cdn.example/abc.pdf', 'Ödev.pdf')).toBe('https://cdn.example/abc.pdf');
    expect(downloadPath('/api/files/token', 'Ödev.pdf')).toBe('/api/files/token');
  });

  it('leaves the link alone when there is no name', () => {
    expect(downloadPath('/uploads/abc.pdf', null)).toBe('/uploads/abc.pdf');
  });
});
