import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

// Fester Turnier-Orga-Account. Wer sich mit diesem Benutzernamen + dem passenden Passwort
// anmeldet, bekommt Orga-Rechte (Tisch erstellen, Spieler kicken) - serverseitig durchgesetzt
// über die Firestore-Regel isOrganizer(), die genau diese E-Mail im Auth-Token prüft.
export const ORGANIZER_EMAIL = 'panda@tichu.local';

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@tichu.local`;
}

function waitForAuthReady() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

// Liefert den bereits angemeldeten Nutzer oder null - meldet NICHT selbst an (siehe login()).
export async function getSignedInUser() {
  return waitForAuthReady();
}

// Einfacher Benutzername+Passwort-Login: existiert der Account schon, wird er eingeloggt;
// existiert er noch nicht, wird er beim ersten Login neu angelegt (selbes Passwort = Zugang
// zu diesem Namen für immer). Für den Orga-Account ("Panda") legt das erste Login mit dem
// vereinbarten Passwort den Account fest - danach schützt Firebase Auth selbst das Passwort.
export async function login(username, password) {
  const name = username.trim();
  if (!name) throw new Error('Bitte einen Benutzernamen eingeben.');
  if (!password) throw new Error('Bitte ein Passwort eingeben.');
  const email = usernameToEmail(name);

  let user;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    user = cred.user;
  } catch (signInErr) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      user = cred.user;
    } catch (createErr) {
      if (createErr.code === 'auth/email-already-in-use') {
        // Account existiert bereits, aber mit einem ANDEREN Passwort als eingegeben.
        const wrong = new Error('Falscher Benutzername oder falsches Passwort.');
        wrong.code = 'auth/wrong-password';
        throw wrong;
      }
      throw createErr;
    }
  }

  const existing = await getProfile(user.uid);
  if (!existing || !existing.displayName) {
    await setDisplayName(user.uid, name);
  }
  return user;
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
  return !!user && user.email === ORGANIZER_EMAIL;
}
