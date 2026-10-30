// Firebase-Projekt "tichu-1c42b" - neu angelegt, nie öffentlich exponiert.
// Der apiKey ist bei Firebase bewusst ein öffentlicher Client-Schlüssel; die eigentliche
// Absicherung passiert über Firestore-Security-Rules (siehe firestore.rules) und Auth.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, clearIndexedDbPersistence,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyDxOJv1ZpVsLoiXxnmyt8UVjUPss_mo9yM',
  authDomain: 'tichu-1c42b.firebaseapp.com',
  projectId: 'tichu-1c42b',
  storageBucket: 'tichu-1c42b.firebasestorage.app',
  messagingSenderId: '706649905138',
  appId: '1:706649905138:web:81254a3c0f06e1359ffd6b',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Kosten sparen: Firestore berechnet jedes vom Server gelieferte Dokument als Lesezugriff. Mit dem
// Standard-Speicher (nur im Arbeitsspeicher) liest JEDE Seite und jedes Neuladen ihre Listen komplett
// neu - der Turnier-Hub (Spieler, Spielplan, alle Tische), das Spielbrett mit seinem ganzen Zug-Log,
// Zuschauen. Mit dauerhaftem lokalem Speicher liefert der Browser Bekanntes selbst, und der Server
// schickt bei erneutem Zuhören (bis 30 Minuten danach) nur noch, was sich geändert hat. Klappt der
// Speicher nicht (z. B. privates Fenster), läuft alles wie bisher im Arbeitsspeicher.
function createDb() {
  try {
    return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    return getFirestore(app); // schon (anders) gestartet, z. B. wenn dieses Modul zweimal geladen wurde
  }
}
export const db = createDb();

// Nach dem Abmelden (siehe lib/auth.js) den lokalen Speicher leeren: Er gehört zum Browser, nicht zum
// Konto - ein anderer Spieler am selben Gerät soll nichts vom vorigen sehen (z. B. Handkarten).
try {
  if (localStorage.getItem('tichu.wipeCache')) {
    localStorage.removeItem('tichu.wipeCache');
    await clearIndexedDbPersistence(db);
  }
} catch (e) { /* nicht schlimm: dann bleibt der Speicher eben bestehen */ }
