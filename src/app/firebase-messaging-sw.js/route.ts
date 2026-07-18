const FIREBASE_WEB_SDK_VERSION = '12.10.0';

export const dynamic = 'force-dynamic';

export function GET() {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
  };
  const messagingConfigured = Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId,
  );

  const messagingScript = messagingConfigured
    ? `
importScripts(
  "https://www.gstatic.com/firebasejs/${FIREBASE_WEB_SDK_VERSION}/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/${FIREBASE_WEB_SDK_VERSION}/firebase-messaging-compat.js"
);

firebase.initializeApp(${JSON.stringify(firebaseConfig)});
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  self.registration.showNotification(data.title || "Formix", {
    body: data.body || "新しいお知らせがあります。",
    icon: "/images/icon.webp",
    badge: "/images/icon.webp",
    tag: data.campaignId || "formix-notification",
    data: { link: data.link || "/" },
  });
});`
    : 'console.warn("Formix push messaging is not configured.");';

  const source = `"use strict";
${messagingScript}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedLink = event.notification.data && event.notification.data.link
    ? event.notification.data.link
    : "/";
  const requestedUrl = new URL(requestedLink, self.location.origin);
  const targetUrl = requestedUrl.origin === self.location.origin
    ? requestedUrl.href
    : new URL("/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("navigate" in client && "focus" in client) {
          return client.navigate(targetUrl).then(() => client.focus());
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
`;

  return new Response(source, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}
