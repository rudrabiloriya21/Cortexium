import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBhcMO9kC8oPl7VEKx_zFo0kZ8gpThJvRc",
  authDomain: "learnix-78dfa.firebaseapp.com",
  projectId: "learnix-78dfa",
  storageBucket: "learnix-78dfa.firebasestorage.app",
  messagingSenderId: "380653984405",
  appId: "1:380653984405:web:a8bef309425e634967999c",
  measurementId: "G-SX9QBHNH34"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);
