// SkillSprint LMS - authentication helpers.
// Salted scrypt password hashing and Bearer-token sessions via node:crypto.

const crypto = require('crypto');

// Derive a 64-byte scrypt hash for (password, salt). Hex-encoded for storage.
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Verify a login attempt against the stored hash using a timing-safe compare.
function verifyPassword(password, salt, expectedHash) {
  const attempt = hashPassword(password, salt);
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Extract a Bearer token from the Authorization header. Returns null when absent.
function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Strip sensitive fields before a user object ever leaves the API.
function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.created_at };
}

module.exports = { hashPassword, verifyPassword, bearerToken, publicUser };
