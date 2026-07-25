import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function AuthForm({ user, loading }) {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [signingIn, setSigningIn] = useState(false);

  // Redirect authenticated users away from the login screen.
  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, loading, navigate]);

  // Initiate Supabase-hosted Google OAuth flow.
  const handleGoogleLogin = async () => {
    setError(null);
    setSigningIn(true);
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (authError) {
        setError(authError.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-2xl shadow-black/50 backdrop-blur">
        <div className="mb-10 space-y-3 text-center">
          <h1 className="text-3xl font-semibold text-white">Sign in to continue</h1>
          <p className="text-sm text-zinc-400">
            Use your Google account to access personalized dashboards, watchlists, and analytics powered by Supabase.
          </p>
        </div>
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={signingIn}
          className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 font-medium text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          {signingIn ? 'Redirecting…' : 'Continue with Google'}
        </button>
        {error ? (
          <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        <p className="mt-8 text-center text-xs text-zinc-500">
          By signing in you agree to our Terms of Use and acknowledge the market risk disclosures.
        </p>
      </div>
    </div>
  );
}
