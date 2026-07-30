const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 210000;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const padded = String(value || '').replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value || '')));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hashPassword(password, salt = randomToken(16), iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: base64UrlToBytes(salt), iterations },
    key,
    256,
  );
  return { hash: bytesToBase64Url(new Uint8Array(bits)), salt, iterations };
}

export async function verifyPassword(password, storedHash, salt, iterations) {
  if (!storedHash || !salt) return false;
  const candidate = await hashPassword(password, salt, Number(iterations) || PASSWORD_ITERATIONS);
  const left = base64UrlToBytes(candidate.hash);
  const right = base64UrlToBytes(storedHash);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function passwordPolicy(password) {
  const value = String(password || '');
  if (value.length < 12) return 'Password must contain at least 12 characters.';
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    return 'Password must include uppercase, lowercase, and numeric characters.';
  }
  return '';
}

export function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

export function sessionCookie(token, maxAge = 43200) {
  return `e88_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function expiredSessionCookie() {
  return 'e88_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
}
