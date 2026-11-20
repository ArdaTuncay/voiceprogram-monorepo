import { createContext } from 'react';

/**
 * The element views render their title and buttons into (see TopBar.tsx's
 * TopBarSlot). `undefined` means there is no TopBar above at all (a view
 * rendered on its own, as in its unit tests) — TopBarSlot then renders in
 * place. `null` means the TopBar hasn't mounted its slot yet (one render).
 */
export const TopBarSlotContext = createContext<HTMLElement | null | undefined>(undefined);
