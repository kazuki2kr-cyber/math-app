import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';

const fallbackRealtimeDatabaseUrl = 'https://math-app-26c77-default-rtdb.asia-southeast1.firebasedatabase.app';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || fallbackRealtimeDatabaseUrl,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Next.js (SSR) / React Native のため、二重初期化を防ぐ
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

let realtimeDbInitialized = false;

export function getRealtimeDb() {
  const realtimeDb = getDatabase(app);
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true' && !realtimeDbInitialized) {
    connectDatabaseEmulator(realtimeDb, '127.0.0.1', 9000);
    realtimeDbInitialized = true;
  }
  return realtimeDb;
}

if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
  // To avoid multiple connections in hot reload
  if (!(auth as any)._emulatorToggled) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    (auth as any)._emulatorToggled = true;
    console.log("🔥 Firebase Emulators Connected");
  }
}

export default app;
