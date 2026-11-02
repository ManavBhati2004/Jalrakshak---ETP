/* ============================================================
   Server only - the Firebase Admin SDK.

   Used for the one thing the browser cannot do: set another account's password (the Monitoring
   Body's reset of a unit login). Imported only by app/api routes, never by client code.

   Production reads the service-account key from FIREBASE_SERVICE_ACCOUNT (the key's JSON, or that
   JSON base64-encoded), set in each Vercel project's environment - never committed. Local testing
   against the emulators needs no key: both emulator hosts are set by the test run.
   ============================================================ */

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const APP_NAME = "jalrakshak-admin";

/** This deployment has no (usable) admin key configured. */
export class AdminNotConfigured extends Error {}

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) throw new AdminNotConfigured("FIREBASE_SERVICE_ACCOUNT is not set.");
  let sa: { project_id?: string; client_email?: string; private_key?: string };
  try {
    sa = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    throw new AdminNotConfigured("FIREBASE_SERVICE_ACCOUNT is not a valid service-account key.");
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new AdminNotConfigured("FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key.");
  }
  return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key };
}

function adminApp(): App {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID }, APP_NAME);
  }
  const sa = serviceAccount();
  return initializeApp({ credential: cert(sa), projectId: sa.projectId }, APP_NAME);
}

/** Admin Auth and Firestore. Throws AdminNotConfigured when this deployment has no key. */
export function adminServices() {
  const app = adminApp();
  return { auth: getAuth(app), db: getFirestore(app) };
}
