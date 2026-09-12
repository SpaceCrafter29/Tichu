// Firebase-Projekt "tichu-1c42b" - neu angelegt, nie öffentlich exponiert.
// Der apiKey ist bei Firebase bewusst ein öffentlicher Client-Schlüssel; die eigentliche
// Absicherung passiert über Firestore-Security-Rules (siehe firestore.rules) und Auth.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDxOJv1ZpVsLoiXxnmyt8UVjUPss_mo9yM',
  authDomain: 'tichu-1c42b.firebaseapp.com',
  projectId: 'tichu-1c42b',
  storageBucket: 'tichu-1c42b.firebasestorage.app',
  messagingSenderId: '706649905138',
  appId: '1:706649905138:web:81254a3c0f06e1359ffd6b',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
