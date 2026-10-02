// Benutzername+Passwort-Konten für den Turnier-Modus - komplett getrennt von der anonymen
// Free-Play-Anmeldung in auth.js (eigene, stabile Identität über mehrere Turniertage/Geräte
// hinweg, siehe README der Übergabe). Firebase Auth kennt nur E-Mail+Passwort, der
// Benutzername wird deshalb intern in eine Pseudo-Mail übersetzt ("<benutzername>@tichu.local") -
// für Spieler komplett unsichtbar, nirgendwo eine echte, erreichbare Adresse.
import { app, db, firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { doc, setDoc, getDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

// board.html (und andere Seiten) verlangen ein users/{uid}-Profil mit displayName (siehe dortige
// Prüfung) - für Turnier-Accounts selbst angelegt (Self-Write, keine Regeländerung nötig),
// einmalig beim ersten Login. Der Name wird im Turnier-Modus NIE angezeigt (siehe
// seatLabel() in board.html - Turnier-Sitze sind immer "Du/Partner/Gegner X"), dient hier nur
// dazu, die bestehende Profil-Pflicht zu erfüllen.
export async function ensureUserProfile(uid, username) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { displayName: username, updatedAt: serverTimestamp() });
  }
}

const auth = getAuth(app);

function emailFor(username) {
  return `${username.trim().toLowerCase()}@tichu.local`;
}

function waitForAuthReady() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => { unsub(); resolve(user); });
  });
}

// Liefert den aktuell angemeldeten Turnier-Account oder null (KEIN automatisches Anlegen wie
// bei der anonymen Free-Play-Anmeldung - ohne gültigen Account geht's zurück zum Login).
export async function currentTournamentUser() {
  return waitForAuthReady();
}

export async function tournamentLogin(username, password) {
  const cred = await signInWithEmailAndPassword(auth, emailFor(username), password);
  return cred.user;
}

export async function tournamentLogout() {
  await signOut(auth);
}

export async function getPlayerProfile(uid) {
  const snap = await getDoc(doc(db, 'players', uid));
  return snap.exists() ? snap.data() : null;
}

// Zweite, unabhängige Firebase-App-Instanz NUR fürs Anlegen neuer Accounts durch den Admin -
// sonst würde createUserWithEmailAndPassword() automatisch als der NEUEN Person anmelden und
// den Admin aus seiner eigenen Sitzung werfen. Die eigentlichen players/playerSecrets-Dokumente
// werden trotzdem über die normale (Admin-)Verbindung geschrieben, nicht über diese zweite App.
const secondaryApp = initializeApp(firebaseConfig, 'tournament-admin-create');
const secondaryAuth = getAuth(secondaryApp);

// Nur vom Admin aufzurufen (sonst lehnen die Firestore-Regeln den players/playerSecrets-Schreib-
// zugriff ab). Gibt die neue uid zurück.
export async function adminCreatePlayer(username, password) {
  const cred = await createUserWithEmailAndPassword(secondaryAuth, emailFor(username), password);
  const uid = cred.user.uid;
  await signOut(secondaryAuth);
  await setDoc(doc(db, 'players', uid), { username: username.trim(), createdAt: serverTimestamp() });
  await setDoc(doc(db, 'playerSecrets', uid), { password });
  return uid;
}

// "Löschen" entfernt den Account nur aus dem Turnier (players/playerSecrets-Dokument weg - ohne
// players-Eintrag zählt die uid nirgendwo mehr mit). Das zugrunde liegende Firebase-Auth-Konto
// lässt sich ohne eigenes Backend (Admin SDK) nicht von hier aus löschen - bleibt als
// harmlose Karteileiche bestehen, kann sich aber mangels players-Dokument nirgendwo mehr
// einloggen/auswirken.
export async function adminDeletePlayer(uid) {
  await deleteDoc(doc(db, 'playerSecrets', uid));
  await deleteDoc(doc(db, 'players', uid));
}

export async function adminGetPassword(uid) {
  const snap = await getDoc(doc(db, 'playerSecrets', uid));
  return snap.exists() ? snap.data().password : null;
}
