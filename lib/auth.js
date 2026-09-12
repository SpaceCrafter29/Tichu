import { auth, db } from './firebase-config.js';
import {
  signInAnonymously,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

function waitForAuthReady() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

// Meldet den Browser anonym an (stabile uid pro Gerät/Browser), falls noch nicht angemeldet.
export async function ensureSignedIn() {
  const existing = await waitForAuthReady();
  if (existing) return existing;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

// Der Anzeigename ist nur für das eigene Profil/Turniertabelle gedacht - innerhalb eines
// laufenden Spiels sehen andere Spieler ihn NICHT (siehe lib/lobby.js: anonyme Sitz-Tokens).
export async function setDisplayName(uid, displayName) {
  await setDoc(
    doc(db, 'users', uid),
    { displayName: displayName.trim().slice(0, 40), updatedAt: serverTimestamp() },
    { merge: true }
  );
}
