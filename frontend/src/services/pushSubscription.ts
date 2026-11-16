/** This browser's push subscription, without any server call — kept apart
 * from services/push.ts so services/session.ts can drop it at logout without
 * importing api.ts (which imports session.ts). */

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager?.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Unsubscribes this browser, so whoever signs in here next doesn't get the
 * previous account's notifications. Best effort, never throws. */
export async function dropBrowserPushSubscription(): Promise<void> {
  try {
    await (await currentPushSubscription())?.unsubscribe();
  } catch {
    // Nothing to do: the server forgets it once the push service says it's gone.
  }
}
