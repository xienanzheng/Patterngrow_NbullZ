// Mirrors the Python PKCE redirect handling from analytics_backend/app.py
// by exchanging OAuth codes for a Supabase session inside the browser.

import { useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * Handles Supabase PKCE redirects by extracting the auth code from the URL,
 * asking Supabase to exchange it for a session, and finally cleaning up the query string.
 * This keeps the React client aligned with the previous Streamlit implementation.
 */
export function useSupabasePkceRedirect() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const hasError = url.searchParams.has('error_description');

    if (!code && !hasError) return;

    const exchangeSession = async () => {
      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error('Supabase PKCE exchange failed', error);
          }
        }
      } catch (err) {
        console.error('Supabase PKCE exchange threw', err);
      } finally {
        ['code', 'state', 'error', 'error_description'].forEach((param) => {
          if (url.searchParams.has(param)) {
            url.searchParams.delete(param);
          }
        });
        const newSearch = url.searchParams.toString();
        const cleanUrl = `${url.origin}${url.pathname}${newSearch ? `?${newSearch}` : ''}${url.hash}`;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    };

    exchangeSession();
  }, []);
}
