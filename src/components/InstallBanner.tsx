import { useEffect, useRef, useState } from 'react';

// Minimal shape of the beforeinstallprompt event. Defined locally because
// not every TS lib.dom version ships BeforeInstallPromptEvent.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// The event is stashed here by main.tsx, which listens for it before React
// mounts, so we never miss it if it fires before this component mounts.
declare global {
  interface Window {
    __gaspiracyInstallPrompt?: BeforeInstallPromptEvent;
  }
}

const DISMISSED_KEY = 'gaspiracy_install_banner_dismissed_v1';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const AUTO_DISMISS_MS = 8000; // 8 seconds

function isInstalled(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari: no beforeinstallprompt, standalone flag instead.
  return (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports as a Mac; touch points give it away.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function wasDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function recordDismissal(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    // Private mode etc. Banner just shows again next visit.
  }
}

type BannerMode = 'prompt' | 'ios';

// Slide-down bar fixed to the top of the page, offering to install the app.
// Shows on the beforeinstallprompt event (Android/Chrome/desktop) or with
// manual instructions on iOS Safari, which has no install prompt event.
// Auto-dismisses after 8 seconds and stays hidden for 7 days after any
// dismissal or install choice. Never shows when already installed.
export function InstallBanner() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<BannerMode>('prompt');
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const timerRef = useRef<number | null>(null);

  const hide = (remember: boolean) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (remember) recordDismissal();
    setVisible(false);
  };

  useEffect(() => {
    if (isInstalled() || wasDismissedRecently()) return;

    if (isIOS()) {
      // iOS Safari never fires beforeinstallprompt, so show the
      // instructions variant straight away.
      setMode('ios');
      setVisible(true);
      return;
    }

    const showWithPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      deferredPromptRef.current = e;
      window.__gaspiracyInstallPrompt = e;
      setMode('prompt');
      setVisible(true);
    };

    // Event may already have fired before this component mounted.
    if (window.__gaspiracyInstallPrompt) {
      deferredPromptRef.current = window.__gaspiracyInstallPrompt;
      setMode('prompt');
      setVisible(true);
      return;
    }

    const onBeforeInstallPrompt = (e: Event) => {
      showWithPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, []);

  // Auto-dismiss a few seconds after the banner appears.
  useEffect(() => {
    if (!visible) return;
    timerRef.current = window.setTimeout(() => hide(true), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleInstall = async () => {
    const deferred = deferredPromptRef.current;
    if (!deferred) {
      hide(true);
      return;
    }
    try {
      await deferred.prompt();
      // Outcome does not matter: the banner hides either way.
      await deferred.userChoice;
    } catch {
      // Prompt already used or rejected; still hide the banner.
    } finally {
      deferredPromptRef.current = null;
      window.__gaspiracyInstallPrompt = undefined;
      hide(true);
    }
  };

  if (!visible) return null;

  return (
    <div
      role="banner"
      className="animate-install-slide-down fixed inset-x-0 top-0 z-50 border-b border-amber-500/40 bg-[#0a0a0c]/95 shadow-lg shadow-black/60 backdrop-blur"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5 sm:px-4">
        <img
          src="/icon-192.png"
          alt=""
          aria-hidden="true"
          className="h-9 w-9 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          {mode === 'prompt' ? (
            <>
              <p className="truncate text-sm font-semibold text-amber-100">
                Install GaspiracyAI as an app
              </p>
              <p className="truncate text-xs text-zinc-400">
                Add it to your home screen for the full-screen experience.
              </p>
            </>
          ) : (
            <p className="text-sm font-semibold text-amber-100">
              Tap Share, then Add to Home Screen to install GaspiracyAI.
            </p>
          )}
        </div>
        {mode === 'prompt' && (
          <button
            type="button"
            onClick={handleInstall}
            className="shrink-0 rounded-full bg-amber-500 px-4 py-1.5 text-sm font-semibold text-black hover:bg-amber-400 active:bg-amber-600"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={() => hide(true)}
          aria-label="Dismiss"
          className="shrink-0 rounded-full px-2 py-1 text-lg leading-none text-zinc-400 hover:text-white"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
