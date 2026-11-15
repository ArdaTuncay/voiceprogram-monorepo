import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ImagePicker from '../ImagePicker';
import AvatarFace from '../AvatarFace';

vi.mock('../../services/api', () => ({ uploadFile: vi.fn() }));

import { uploadFile } from '../../services/api';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pick(file: File) {
  fireEvent.change(screen.getByLabelText('Resim seç'), { target: { files: [file] } });
}

describe('ImagePicker', () => {
  it('uploads the chosen image and saves its URL', async () => {
    vi.mocked(uploadFile).mockResolvedValue({ data: { file_url: '/uploads/a.png', file_type: 'image/png' } });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ImagePicker label="Profil fotoğrafı" currentUrl={null} fallback="AB" onSave={onSave} />);

    await act(async () => {
      pick(new File(['x'], 'a.png', { type: 'image/png' }));
    });

    expect(uploadFile).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledWith('/uploads/a.png');
  });

  it('removes the current image', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ImagePicker label="Profil fotoğrafı" currentUrl="/uploads/a.png" fallback="AB" onSave={onSave} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kaldır' }));
    });

    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('offers no remove button when there is no image', () => {
    render(<ImagePicker label="Profil fotoğrafı" currentUrl={null} fallback="AB" onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Kaldır' })).toBeNull();
  });

  it('rejects a non-image or oversized file before uploading', async () => {
    const onSave = vi.fn();
    render(<ImagePicker label="Profil fotoğrafı" currentUrl={null} fallback="AB" onSave={onSave} />);

    await act(async () => {
      pick(new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    });
    expect(screen.getByText(/PNG, JPEG, GIF veya WEBP/)).not.toBeNull();

    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await act(async () => {
      pick(big);
    });
    expect(screen.getByText(/8MB/)).not.toBeNull();

    expect(uploadFile).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the error the save returns', async () => {
    vi.mocked(uploadFile).mockResolvedValue({ data: { file_url: '/uploads/a.png', file_type: 'image/png' } });
    render(
      <ImagePicker
        label="Profil fotoğrafı"
        currentUrl={null}
        fallback="AB"
        onSave={vi.fn().mockResolvedValue('Geçersiz resim')}
      />
    );

    await act(async () => {
      pick(new File(['x'], 'a.png', { type: 'image/png' }));
    });

    expect(screen.getByText('Geçersiz resim')).not.toBeNull();
  });
});

describe('AvatarFace', () => {
  it('shows the picture when there is one', () => {
    const { container } = render(<AvatarFace url="/uploads/a.png" fallback="AB" />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(screen.queryByText('AB')).toBeNull();
  });

  it('falls back to the initials without a picture, or if it fails to load', () => {
    const { container, rerender } = render(<AvatarFace url={null} fallback="AB" />);
    expect(screen.getByText('AB')).not.toBeNull();

    rerender(<AvatarFace url="/uploads/broken.png" fallback="AB" />);
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByText('AB')).not.toBeNull();
  });
});
