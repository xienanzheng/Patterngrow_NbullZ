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
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl shadow-blue-500/10 backdrop-blur">
        <div className="mb-10 space-y-3 text-center">
          <p className="inline-flex items-center rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-300">
            AI Stock Intelligence
          </p>
          <h1 className="text-3xl font-semibold text-white">Sign in to continue</h1>
          <p className="text-sm text-slate-400">
            Use your Google account to access personalized dashboards, watchlists, and analytics powered by Supabase.
          </p>
        </div>
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={signingIn}
          className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 font-medium text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <img
            src="https://www.svgrepo.com/show/475656/google-color.svg"
            alt="Google"
            className="h-5 w-5"
            loading="lazy"
          />
          {signingIn ? 'Redirecting…' : 'Continue with Google'}
        </button>
        {error ? (
          <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        <p className="mt-8 text-center text-xs text-slate-500">
          By signing in you agree to our Terms of Use and acknowledge the market risk disclosures.
        </p>
      </div>
    </div>
  );
}
