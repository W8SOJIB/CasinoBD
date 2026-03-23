import admin from "firebase-admin";

let isInitialized = false;

function initAdmin() {
  if (isInitialized) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error(
      "Missing FIREBASE_SERVICE_ACCOUNT_JSON env var (service account JSON as a string)."
    );
  }

  const serviceAccount = JSON.parse(serviceAccountJson) as admin.ServiceAccount;

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  isInitialized = true;
}

export function getAdminApp() {
  initAdmin();
  return admin;
}

export function getFirestore() {
  initAdmin();
  return admin.firestore();
}

export function serverTimestamp() {
  initAdmin();
  return admin.firestore.FieldValue.serverTimestamp();
}

export function getAuth() {
  initAdmin();
  return admin.auth();
}

export async function verifyFirebaseIdToken(idToken: string) {
  initAdmin();
  return admin.auth().verifyIdToken(idToken);
}

