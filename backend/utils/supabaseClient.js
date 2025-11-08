import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY ?? serviceKey;

if (!supabaseUrl || !serviceKey) {
  throw new Error('Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
}

export const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export const supabaseAnon = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

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
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: error?.message ?? 'Unable to resolve Supabase user from token' };
  }
  return { user: data.user, token };
}
