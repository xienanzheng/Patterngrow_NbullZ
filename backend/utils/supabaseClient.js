import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

// Public historical research does not require an account service. Private routes
// still require verified authentication and fail closed when it is unconfigured.
export const supabaseAdmin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
}) : null;

export function extractBearerToken(req) {
  const header = req.headers?.authorization ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim();
}

export async function getUserFromRequest(req) {
  const token = extractBearerToken(req);
  if (!token) {
    return { user: null, error: 'Missing bearer token' };
  }
  if (!supabaseAdmin) {
    return { user: null, error: 'Sign-in is unavailable on this server.' };
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: error?.message ?? 'Unable to resolve Supabase user from token' };
  }
  return { user: data.user, token };
}
