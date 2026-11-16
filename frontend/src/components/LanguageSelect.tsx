import { Languages } from 'lucide-react';
import { LANGUAGES, useLanguageStore, useT, type Language } from '../i18n';
import './LanguageSelect.css';

interface Props {
  /** Extra class for placement (e.g. the sign-in card's top corner). */
  className?: string;
}

/** Turkish/English switch — on the sign-in screens and in Settings. The
 * choice is saved in this browser (see ../i18n). Each language's own name is
 * shown in that language, so it's recognizable whichever one is active. */
export default function LanguageSelect({ className }: Props) {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);

  return (
    <div className={`language-select${className ? ` ${className}` : ''}`}>
      <Languages size={14} aria-hidden="true" />
      <select
        aria-label={t('Dil')}
        value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}
