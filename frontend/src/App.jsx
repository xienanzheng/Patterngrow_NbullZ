import { Component } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AuthForm from './components/AuthForm';
import Dashboard from './components/Dashboard';
import { useSupabaseAuth } from './hooks/useSupabaseAuth';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Uncaught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-200">
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-zinc-400">Something went wrong. Please refresh the page.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-300"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
      <div className="flex flex-col items-center gap-2">
        <span className="h-3 w-3 animate-pulse rounded-full bg-amber-400" />
        <p className="text-sm text-zinc-400">Loading session…</p>
      </div>
    </div>
  );
}

function App() {
  const { user, session, loading, signOut } = useSupabaseAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
        <Route path="/login" element={<AuthForm user={user} loading={loading} />} />
        <Route
          path="/dashboard"
          element={
            user ? (
              <Dashboard user={user} session={session} onSignOut={signOut} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
