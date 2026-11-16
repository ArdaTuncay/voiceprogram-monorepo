import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { uploadFile } from '../services/api';
import AvatarFace from './AvatarFace';
import './AvatarFace.css';

// Same limits Backend.Uploads enforces — checked here first so an obviously
// wrong file fails instantly instead of after a full upload.
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024;

interface Props {
  label: string;
  currentUrl: string | null | undefined;
  /** Shown in the preview when there's no image — usually initials. */
  fallback: string;
  /** Background behind the fallback (e.g. the user's color). */
  color?: string;
  /** Saves the new URL (or null to remove); resolves to an error message, if any. */
  onSave: (url: string | null) => Promise<string | undefined>;
}

/** Choose, upload and save a profile picture or server icon, or remove it.
 * Uploads through the normal POST /api/upload, then hands the URL to onSave. */
export default function ImagePicker({ label, currentUrl, fallback, color, onSave }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(url: string | null) {
    const saveError = await onSave(url);
    if (saveError) setError(saveError);
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError('');
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Sadece PNG, JPEG, GIF veya WEBP resimleri yüklenebilir.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Resim çok büyük (en fazla 8MB).');
      return;
    }

    setBusy(true);
    const { data, error: uploadError } = await uploadFile(file);
    if (uploadError || !data) {
      setError(uploadError ?? 'Resim yüklenemedi.');
    } else {
      await save(data.file_url);
    }
    setBusy(false);
  }

  async function handleRemove() {
    setError('');
    setBusy(true);
    await save(null);
    setBusy(false);
  }

  return (
    <div className="image-picker">
      <div className="image-picker-preview" style={color ? { background: color } : undefined}>
        <AvatarFace url={currentUrl} fallback={fallback} />
      </div>
      <div className="image-picker-body">
        <span className="image-picker-label">{label}</span>
        <div className="image-picker-actions">
          <button type="button" className="image-picker-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Yükleniyor…' : currentUrl ? 'Değiştir' : 'Resim yükle'}
          </button>
          {currentUrl && (
            <button type="button" className="image-picker-btn" onClick={handleRemove} disabled={busy}>
              Kaldır
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          aria-label="Resim seç"
          hidden
          onChange={handleFile}
        />
        {error ? (
          <span className="image-picker-error">{error}</span>
        ) : (
          <span className="image-picker-hint">PNG, JPEG, GIF veya WEBP, en fazla 8MB.</span>
        )}
      </div>
    </div>
  );
}
