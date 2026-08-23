const SERVICE_WORKER_URL = '/firebase-messaging-sw.js';
const SERVICE_WORKER_SCOPE = '/';
const ACTIVATION_TIMEOUT_MS = 15_000;

let registrationInFlight: Promise<ServiceWorkerRegistration | null> | null = null;

export async function waitForServiceWorkerActivation(
  registration: ServiceWorkerRegistration,
  timeoutMs = ACTIVATION_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration> {
  if (registration.active) return registration;

  const incomingWorker = registration.installing || registration.waiting;
  if (!incomingWorker) {
    throw new Error('Service Workerの有効化対象が見つかりませんでした。');
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      incomingWorker.removeEventListener('statechange', handleStateChange);
      if (error) reject(error);
      else resolve();
    };
    const handleStateChange = () => {
      if (incomingWorker.state === 'activated') finish();
      if (incomingWorker.state === 'redundant') {
        finish(new Error('Service Workerの有効化に失敗しました。'));
      }
    };
    const timeoutId = globalThis.setTimeout(() => {
      finish(new Error('Service Workerの有効化がタイムアウトしました。'));
    }, timeoutMs);

    incomingWorker.addEventListener('statechange', handleStateChange);
    handleStateChange();
  });

  return registration;
}

async function registerAndActivateServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: SERVICE_WORKER_SCOPE,
  });
  return waitForServiceWorkerActivation(registration);
}

export async function registerPwaServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!registrationInFlight) {
    registrationInFlight = registerAndActivateServiceWorker();
  }

  const currentRegistration = registrationInFlight;
  try {
    return await currentRegistration;
  } finally {
    if (registrationInFlight === currentRegistration) registrationInFlight = null;
  }
}
