// Centralised Supabase client configured for persistent browser sessions.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const storage = typeof window !== 'undefined' ? window.localStorage : undefined;

// Anonymous research remains usable when account features are not configured.
export const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // PKCE redirects are resolved manually via useSupabasePkceRedirect to mirror the legacy Streamlit flow.
    detectSessionInUrl: false,
    flowType: 'pkce',
    storageKey: 'stock-dashboard-auth',
    storage,
  },
}) : null;
