import { useEffect, useState } from 'react';
import { resolveFileUrl } from '../config';
import './AvatarFace.css';

interface Props {
  /** A profile picture or server icon URL (see Backend.Uploads), or null. */
  url?: string | null;
  /** What to show without a picture — usually initials. */
  fallback: string;
}

/** The inside of an avatar/icon bubble: the picture when there is one (and it
 * loads), otherwise the fallback text. The caller's wrapper keeps its own
 * size, shape and background color. */
export default function AvatarFace({ url, fallback }: Props) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return (
      <img className="avatar-face-img" src={resolveFileUrl(url)} alt="" onError={() => setFailed(true)} />
    );
  }
  return <>{fallback}</>;
}
