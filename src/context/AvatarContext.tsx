/**
 * Single source of truth for the assistant's avatar kind + look (colour
 * scheme) — fixes a device-reported blink: NativeTabs keeps every tab
 * mounted, and `<DepthField/>`/`<AssistantAvatar/>` used to each keep their
 * OWN `useState` seeded with the default and re-read asynchronously in a
 * `useFocusEffect`. Arriving on a tab therefore painted a stale value first
 * (the default, or whatever that instance last read) and then flipped once
 * its own async read resolved — a visible colour blink on every tab change,
 * and the same for the avatar's face. Loading the preference exactly ONCE
 * here, with Settings writing through this context (in addition to
 * persisting, same as before), means every consumer shares one synchronous
 * value: there is no per-instance state left to go stale and no async gap to
 * blink through.
 *
 * The trade the fix makes, stated so it is not rediscovered: this context is
 * now the ONE copy that can go stale, where before every screen re-read on
 * focus and self-corrected. Anything that changes the stored value without
 * going through the setters has to say so — today that is restoring a
 * backup, which calls `reload()`.
 *
 * Same shape as `PeriodContext`. Mounted at the app root (`app/_layout.tsx`,
 * beside `ThemeProvider`/`PortalProvider`/`KeyboardProvider`) rather than
 * per-tab like `PeriodProvider`: the avatar look/kind are also read outside
 * the tabs navigator (`welcome.tsx`, `debug-avatar.tsx`).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  AvatarKind,
  AvatarLook,
  DEFAULT_AVATAR_KIND,
  DEFAULT_AVATAR_LOOK,
  kindById,
  lookById,
} from '../domain/avatar';
import {
  getAvatarKind,
  getAvatarLook,
  setAvatarKind as persistAvatarKind,
  setAvatarLook as persistAvatarLook,
} from '../features/settings/repository';

interface AvatarContextValue {
  kind: AvatarKind;
  look: AvatarLook;
  /**
   * False until the persisted kind/look have been read once at startup.
   * Consumers that would otherwise paint the default and flip once this
   * resolves — the exact blink this context exists to prevent — should
   * render nothing (or a same-sized placeholder) until `loaded` is true.
   */
  loaded: boolean;
  /** Updates the shared kind everywhere, then persists it. */
  setKind: (id: string) => Promise<void>;
  /** Updates the shared look everywhere, then persists it. */
  setLook: (id: string) => Promise<void>;
  /** Re-read from the database — for paths that change it behind our back,
   *  i.e. restoring a backup. */
  reload: () => Promise<void>;
}

const AvatarContext = createContext<AvatarContextValue | null>(null);

export function AvatarProvider({ children }: { children: React.ReactNode }) {
  const [kind, setKindState] = useState<AvatarKind>(DEFAULT_AVATAR_KIND);
  const [look, setLookState] = useState<AvatarLook>(() => lookById(DEFAULT_AVATAR_LOOK));
  const [loaded, setLoaded] = useState(false);

  // `loaded` gates the ambient field on every tab AND the avatar's face on
  // home, welcome and debug-avatar, so it MUST end up true even when the
  // read fails. Before this context each component read for itself and an
  // error just left the default look on screen — the app looked normal.
  // Without the catch, centralising the read would turn that graceful
  // degradation into a faceless hero and no background, for the whole
  // session, with no retry. The defaults are already seeded above, so
  // falling through to them is exactly the old behaviour.
  const load = useCallback(async (): Promise<void> => {
    try {
      const [storedKind, storedLook] = await Promise.all([getAvatarKind(), getAvatarLook()]);
      setKindState(kindById(storedKind).id);
      setLookState(lookById(storedLook));
    } catch {
      // keep the seeded defaults
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void load().then(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [load]);

  // Persist BEFORE adopting, the shape settings.tsx already uses for the
  // currency change. These used to be optimistic, which was survivable while
  // every screen re-read on focus: a failed write self-corrected on the next
  // visit. Nothing re-reads now, so an optimistic update that failed to save
  // would show a colour the database never got, app-wide, until relaunch.
  const setKind = useCallback(async (id: string) => {
    const resolved = kindById(id).id;
    await persistAvatarKind(resolved);
    setKindState(resolved);
  }, []);

  const setLook = useCallback(async (id: string) => {
    const resolved = lookById(id);
    await persistAvatarLook(resolved.id);
    setLookState(resolved);
  }, []);

  /** Re-read from the database. A restore replaces the stored look without
   *  going through the setters (backupPolicy.ts keeps avatar_look/kind), and
   *  since the per-screen focus re-reads are gone, this context is now the
   *  one copy that can go stale — so the restore path calls this. */
  const reload = useCallback(() => load(), [load]);

  return (
    <AvatarContext.Provider value={{ kind, look, loaded, setKind, setLook, reload }}>
      {children}
    </AvatarContext.Provider>
  );
}

export function useAvatar(): AvatarContextValue {
  const ctx = useContext(AvatarContext);
  if (!ctx) throw new Error('useAvatar must be used inside AvatarProvider');
  return ctx;
}
