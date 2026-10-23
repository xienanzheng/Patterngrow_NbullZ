import { getUserFromRequest } from './supabaseClient.js';

export async function requireAuth(req, res, next) {
  const { user, token, error } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: error ?? 'Unauthorized' });
  }
  req.user = user;
  req.token = token;
  return next();
}

// Global reference data requires an explicit trusted role, beyond ordinary sign-in.
// app_metadata comes from the verified auth user; user_metadata is user-editable and must not authorize writes.
export function requireAdmin(req, res, next) {
  const allowedIds = new Set((process.env.METADATA_ADMIN_USER_IDS ?? '')
    .split(',').map((id) => id.trim()).filter(Boolean));
  const user = req.user;
  const isAdmin = typeof user?.id === 'string' && user.id.length > 0
    && (allowedIds.has(user.id) || user.app_metadata?.role === 'admin');
  if (!isAdmin) return res.status(403).json({ error: 'Administrator access is required to modify shared metadata.' });
  return next();
}
