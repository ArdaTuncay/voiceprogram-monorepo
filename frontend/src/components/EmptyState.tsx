import mascot from '../assets/zircle-mascot.svg';
import { useT } from '../i18n';
import './EmptyState.css';

interface Props {
  message: string;
}

/** Shared placeholder for "nothing selected yet" screens — the DM/Home
 * view with no room open, and a server view with no channel selected.
 * Kept as one component so both spots stay visually identical instead of
 * drifting apart over time. */
export default function EmptyState({ message }: Props) {
  const t = useT();
  return (
    <div className="empty-state">
      <img src={mascot} alt={t('Zircle maskotu')} className="empty-state-mascot" />
      <p className="empty-state-message">{message}</p>
    </div>
  );
}
