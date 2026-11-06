// Friendly messages for Firebase sign-in errors. Wrong email and wrong password
// read the same, so the form can't be used to find out who has an account.
const MESSAGES = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/invalid-login-credentials': 'Wrong email or password.',
  'auth/invalid-email': "That doesn't look like an email address.",
  'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
  'auth/weak-password': 'Choose a longer password.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': "Couldn't connect. Check your connection and try again.",
  'auth/operation-not-allowed': "Email sign-in isn't turned on yet.",
};

export const authErrorMessage = (code) => MESSAGES[code] ?? "Couldn't sign in. Please try again.";
