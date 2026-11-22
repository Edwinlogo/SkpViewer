import { useCallback, useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export interface PWAState {
  isOnline: boolean;
  offlineReady: boolean;
  needRefresh: boolean;
  canInstall: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  installApp: () => Promise<boolean>;
  updateApp: () => void;
  dismissOfflineReady: () => void;
}

export function usePWA(onLaunchFile?: (file: File) => void): PWAState {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [offlineReady, setOfflineReady] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  });
  const [updateFn, setUpdateFn] = useState<(() => Promise<void>) | null>(null);

  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onOfflineReady() {
        setOfflineReady(true);
      },
      onNeedRefresh() {
        setNeedRefresh(true);
      },
    });
    setUpdateFn(() => updateSW);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleBeforeInstall = (ev: Event) => {
      ev.preventDefault();
      setDeferredPrompt(ev as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // PWA File Handling API: open .skp/.glb/.dae directly from OS
  useEffect(() => {
    if (!onLaunchFile || typeof window === 'undefined' || !window.launchQueue) return;
    window.launchQueue.setConsumer(async (launchParams) => {
      const firstHandle = launchParams.files?.[0];
      if (!firstHandle) return;
      try {
        const file = await firstHandle.getFile();
        onLaunchFile(file);
      } catch {
        // Ignore launch queue error
      }
    });
  }, [onLaunchFile]);

  const installApp = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  }, [deferredPrompt]);

  const updateApp = useCallback(() => {
    if (updateFn) {
      void updateFn();
    } else {
      window.location.reload();
    }
  }, [updateFn]);

  const dismissOfflineReady = useCallback(() => setOfflineReady(false), []);

  return {
    isOnline,
    offlineReady,
    needRefresh,
    canInstall: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    isIOS,
    installApp,
    updateApp,
    dismissOfflineReady,
  };
}
