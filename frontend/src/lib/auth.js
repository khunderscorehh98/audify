// Google sign-in through Firebase (D1). In local development VITE_DEV_AUTH=1
// swaps it for a typed email; the backend refuses that mode in production.
const DEV = import.meta.env.VITE_DEV_AUTH === '1';
const DEV_KEY = 'audify.devEmail';

let firebase = null;

async function loadFirebase() {
  if (firebase) return firebase;
  const [{ initializeApp }, auth] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    // Must be the app's own domain, <project>.web.app (patch 3 §1).
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });
  firebase = { auth: auth.getAuth(app), module: auth };
  return firebase;
}

export const devAuth = DEV;

/** Resolves once the signed-in user is known; null when signed out. */
export async function currentUser() {
  if (DEV) {
    const email = localStorage.getItem(DEV_KEY);
    return email ? { email } : null;
  }
  const { auth, module } = await loadFirebase();
  // Surfaces errors from a finished redirect instead of losing them.
  await module.getRedirectResult(auth).catch((error) => console.warn('Sign-in failed:', error.code));
  await auth.authStateReady();
  return auth.currentUser;
}

/** Development sign-in only: the email is the whole identity. */
export const devSignIn = (email) => localStorage.setItem(DEV_KEY, email);

export async function signInWithGoogle() {
  const { auth, module } = await loadFirebase();
  await module.signInWithRedirect(auth, new module.GoogleAuthProvider());
}

export async function signInWithEmail(email, password) {
  const { auth, module } = await loadFirebase();
  await module.signInWithEmailAndPassword(auth, email, password);
}

export async function createAccount(email, password) {
  const { auth, module } = await loadFirebase();
  const { user } = await module.createUserWithEmailAndPassword(auth, email, password);
  await module.sendEmailVerification(user);
}

export async function resetPassword(email) {
  const { auth, module } = await loadFirebase();
  await module.sendPasswordResetEmail(auth, email);
}

export async function resendVerification() {
  if (DEV) return;
  const { auth, module } = await loadFirebase();
  if (auth.currentUser) await module.sendEmailVerification(auth.currentUser);
}

export async function needsVerification() {
  if (DEV) return false;
  const { auth } = await loadFirebase();
  return auth.currentUser ? !auth.currentUser.emailVerified : false;
}

/** After clicking the email link, a fresh token is what tells the server. */
export async function refreshIdentity() {
  if (DEV) return;
  const { auth } = await loadFirebase();
  if (!auth.currentUser) return;
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
}

export async function signOut() {
  if (DEV) {
    localStorage.removeItem(DEV_KEY);
    return;
  }
  const { auth, module } = await loadFirebase();
  await module.signOut(auth);
}

export async function idToken() {
  if (DEV) {
    const email = localStorage.getItem(DEV_KEY);
    return email ? `dev:${email}` : null;
  }
  const { auth } = await loadFirebase();
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}
