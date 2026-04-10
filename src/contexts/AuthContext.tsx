'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  createdAt?: string;
  lastLoginAt?: string;
  xp?: number;
  icon?: string;
  hasAgreedToTerms?: boolean;
  isAdmin?: boolean;
}

interface AuthContextType {
  user: UserData | null;
  loading: boolean;
  isAdmin: boolean;
  loginWithGoogle: () => Promise<void>;
  loginForEmulator?: () => Promise<void>;
  logout: () => Promise<void>;
  agreeToTerms: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  loginWithGoogle: async () => {},
  logout: async () => {},
  agreeToTerms: async () => {},
  error: null,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // ドメイン制限チェック
        const email = firebaseUser.email || "";
        const isAllowedDomain = email.endsWith('@shibaurafzk.com');
        const isIndividualAllowed = email === 'kazuki2kr@gmail.com';

        if (!isAllowedDomain && !isIndividualAllowed) {
          console.warn("Unauthorized domain. Signing out.");
          await firebaseSignOut(auth);
          setError('@shibaurafzk.com ドメインのGoogleアカウントでログインしてください。');
          setUser(null);
          setIsAdmin(false);
          setLoading(false);
          return;
        }

        try {
          // Check if user exists in Firestore
          const userRef = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userRef);

          const userData: UserData = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || '名無し',
            lastLoginAt: new Date().toISOString(),
          };

          let finalUserData: any;

          if (!userSnap.exists()) {
            // Create new user profile
            finalUserData = {
              ...userData,
              createdAt: new Date().toISOString(),
              xp: 0,
              icon: '📐',
              hasAgreedToTerms: false,
              isAdmin: false,
            };
            await setDoc(userRef, finalUserData);
          } else {
            // Update last login
            finalUserData = {
              ...userData,
              ...userSnap.data()
            };
            if (finalUserData.xp === undefined) finalUserData.xp = 0;
            if (finalUserData.icon === undefined) finalUserData.icon = '📐';
            if (finalUserData.hasAgreedToTerms === undefined) finalUserData.hasAgreedToTerms = false;
            await setDoc(userRef, { lastLoginAt: userData.lastLoginAt }, { merge: true });
          }

          // Check admin custom claim
          const tokenResult = await firebaseUser.getIdTokenResult(true); // Force refresh to be sure
          const adminClaim = !!tokenResult.claims.admin;
          setIsAdmin(adminClaim);

          setUser({ ...finalUserData, isAdmin: adminClaim } as UserData);
          setError(null);
        } catch (err) {
          console.error("Firestore user fetch/create error:", err);
          setError(`ユーザー情報の取得に失敗しました。: ${String(err)}`);
        }
      } else {
        setUser(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    setError(null);
    setLoading(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      hd: 'shibaurafzk.com' // Hint to Google sign-in to prefer this domain
    });

    try {
      await signInWithPopup(auth, provider);
      router.push('/');
    } catch (err: any) {
      console.error("Login popup error:", err);
      // Ignore user-closed popup error
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'ログインに失敗しました。');
      }
      setLoading(false);
    }
  };

  const loginForEmulator = async () => {
    if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR !== 'true') return;
    setError(null);
    setLoading(true);
    try {
      // Dynamic import to avoid including these in production bundle directly if we can, 
      // but it's simpler to just require them or import at top. Let's just use regular import logic.
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import('firebase/auth');
      const testEmail = 'test@shibaurafzk.com';
      const testPass = 'emulator-test-password';
      try {
        await signInWithEmailAndPassword(auth, testEmail, testPass);
      } catch (err: any) {
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
          await createUserWithEmailAndPassword(auth, testEmail, testPass);
        } else {
          throw err;
        }
      }
      router.push('/');
    } catch (err: any) {
      console.error("Emulator Login error:", err);
      setError(err.message || 'エミュレータログインに失敗しました。');
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    await firebaseSignOut(auth);
    router.push('/login');
    setLoading(false);
  };

  const agreeToTerms = async () => {
    if (user) {
      try {
        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, { hasAgreedToTerms: true }, { merge: true });
        setUser({ ...user, hasAgreedToTerms: true });
      } catch (err) {
        console.error("Failed to update agreement status", err);
      }
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, loginWithGoogle, loginForEmulator, logout, agreeToTerms, error }}>
      {children}
    </AuthContext.Provider>
  );
};
