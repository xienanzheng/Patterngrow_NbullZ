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
