// Lightweight auth hook that keeps Supabase session state in sync.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useSupabasePkceRedirect } from './useSupabasePkceRedirect';

export function useSupabaseAuth() {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Ensure PKCE redirects are resolved before we attempt to read the session.
  useSupabasePkceRedirect();

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;
        if (error) {
          console.error('Failed to restore Supabase session', error);
        }
        setSession(data?.session ?? null);
        setUser(data?.session?.user ?? null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);

      // SIGNED_OUT fires when the token is revoked or a refresh fails (as well
      // as on an explicit sign-out). In every case we send the user to /login
      // rather than letting the app keep making silent 401 API calls.
      // useSupabaseAuth runs outside <BrowserRouter> in App.jsx, so useNavigate
      // is not available here — a hard redirect is the correct choice.
      if (event === 'SIGNED_OUT' && typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Failed to sign out:', error);
    }
    setSession(null);
    setUser(null);
    if (typeof window !== 'undefined') {
      try {
        // Matches storageKey 'stock-dashboard-auth' in lib/supabaseClient.js;
        // supabase-js stores the PKCE verifier under `<storageKey>-code-verifier`.
        window.localStorage.removeItem('stock-dashboard-auth-code-verifier');
      } catch {
        // ignore cleanup errors
      }
    }
  };

  return { session, user, loading, signOut };
}
