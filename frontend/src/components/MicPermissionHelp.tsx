import { MicOff } from 'lucide-react';
import { useT } from '../i18n';
import './MicPermissionHelp.css';

interface Props {
  onRetry: () => void;
  onDismiss: () => void;
}

const isDesktopApp = import.meta.env.MODE === 'electron';

/** Shown in the channel column when joining a voice channel failed because
 * the microphone permission was refused — what to change, where, and a
 * retry, instead of a bare error line. The browser step only shows on the
 * web; Windows' own privacy switch applies to both. */
export default function MicPermissionHelp({ onRetry, onDismiss }: Props) {
  const t = useT();
  return (
    <div className="mic-help" role="alert">
      <div className="mic-help-head">
        <span className="mic-help-icon" aria-hidden="true"><MicOff size={16} strokeWidth={1.75} /></span>
        <strong>{t('Mikrofon izni gerekli')}</strong>
      </div>
      <p>{t('Zircle mikrofonuna erişemiyor. Şunları dene:')}</p>
      <ol>
        {!isDesktopApp && (
          <li>{t('Adres çubuğundaki site ayarları (kilit) simgesine tıkla ve Mikrofon için "İzin ver"i seç.')}</li>
        )}
        <li>
          {isDesktopApp
            ? t('Windows Ayarlar > Gizlilik ve güvenlik > Mikrofon\'da "Masaüstü uygulamalarının mikrofonunuza erişmesine izin verin"i aç.')
            : t('Windows Ayarlar > Gizlilik ve güvenlik > Mikrofon\'da tarayıcının mikrofona erişimini aç.')}
        </li>
        <li>{t('Mikrofonun takılı olduğundan emin ol.')}</li>
      </ol>
      <div className="mic-help-actions">
        <button type="button" className="mic-help-retry" onClick={onRetry}>{t('Tekrar dene')}</button>
        <button type="button" className="mic-help-dismiss" onClick={onDismiss}>{t('Kapat')}</button>
      </div>
    </div>
  );
}
