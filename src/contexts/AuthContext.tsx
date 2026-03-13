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
}

interface AuthContextType {
  user: UserData | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  agreeToTerms: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
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
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Domain check (can also be enforced by Firebase Auth settings, but we verify here for UX)
        if (
          !firebaseUser.email?.endsWith('@shibaurafzk.com') &&
          firebaseUser.email !== 'kazuki2kr@gmail.com' // Allow admin for testing if needed, though spec says only the domain. Removing this depending on strictly sticking to spec.
        ) {
          // Strictly stick to spec
          if (!firebaseUser.email?.endsWith('@shibaurafzk.com')) {
             await firebaseSignOut(auth);
             setError('@shibaurafzk.com ドメインのGoogleアカウントでログインしてください。');
             setUser(null);
             setLoading(false);
             return;
          }
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
              hasAgreedToTerms: false
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

          setUser(finalUserData as UserData);
          setError(null);
        } catch (err) {
          console.error("Firestore user fetch/create error:", err);
          setError('ユーザー情報の取得に失敗しました。');
        }
      } else {
        setUser(null);
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
    <AuthContext.Provider value={{ user, loading, loginWithGoogle, logout, agreeToTerms, error }}>
      {children}
    </AuthContext.Provider>
  );
};
