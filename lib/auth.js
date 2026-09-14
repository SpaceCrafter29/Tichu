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

// Fester Turnier-Orga: die anonyme uid des Browsers/Geräts, das die Turnierleitung macht.
// Anonyme Anmeldung merkt sich dieselbe uid über Reloads hinweg (bis Cookies/Storage
// gelöscht werden) - eindeutig genug für ein Freundesturnier, ohne echten Passwort-Account.
// Muss einmal gesetzt werden: die uid im "Meine ID"-Feld auf der Login-Seite ablesen und
// hier eintragen (siehe README).
export const ORGANIZER_UID = 'PASTE_ORGANIZER_UID_HERE';

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

export function isOrganizer(user) {
  return !!user && user.uid === ORGANIZER_UID;
}
