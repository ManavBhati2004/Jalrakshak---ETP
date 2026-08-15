import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// Web client config — sourced from NEXT_PUBLIC_ env vars (see .env.local).
// These values are public by design; access is enforced by Firestore security rules.
// Env vars (see .env.local) take precedence; the fallbacks are the project's
// public web config so the deployed app works even without env vars set on the
// host. Firebase web config is public by design — access is enforced by
// Firebase Auth + Firestore security rules, not by keeping these secret.
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyD_i_Oh4PBefiWqA11fXInGMnod09SxYO4",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "jalrakshak-etp.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "jalrakshak-etp",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "jalrakshak-etp.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "32456689114",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:32456689114:web:aba58d6d56dd40c5ec6ce3",
};

// Guard against re-initialization during Next.js fast refresh / multiple imports.
export const firebaseApp: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth: Auth = getAuth(firebaseApp);
export const db: Firestore = getFirestore(firebaseApp);
