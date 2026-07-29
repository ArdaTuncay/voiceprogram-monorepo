import { useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { getCurrentTheme, toggleTheme } from '../services/theme';

/** Temporary access point for switching themes — there's no settings panel
 * yet, so this lives directly in the profile bar. Move it into Settings
 * once that exists instead of adding a second toggle. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(getCurrentTheme());

  function handleClick() {
    setTheme(toggleTheme());
  }

  const label = theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç';

  return (
    <button
      type="button"
      className="theme-toggle-btn"
      onClick={handleClick}
      title={label}
      aria-label={label}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
