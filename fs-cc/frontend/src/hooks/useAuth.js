// Decodes the JWT payload without verifying the signature.
// Verification happens on the server for every API call.
function decodeJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

function isExpired(payload) {
  if (!payload?.exp) return false;
  return payload.exp * 1000 < Date.now();
}

const TOKEN_KEY = 'cc-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function useAuth() {
  const token   = getToken();
  const payload = token ? decodeJwt(token) : null;

  // Treat expired tokens as no token
  if (payload && isExpired(payload)) {
    clearToken();
    return { token: null, user: null, isAuth: false };
  }

  return {
    token,
    user:   payload ?? null,   // { id, username, role, exp, iat }
    isAuth: !!payload
  };
}
