import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AuthForm from './components/AuthForm';
import Dashboard from './components/Dashboard';
import { useSupabaseAuth } from './hooks/useSupabaseAuth';

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
      <div className="flex flex-col items-center gap-2">
        <span className="h-3 w-3 animate-pulse rounded-full bg-blue-400" />
        <p className="text-sm uppercase tracking-wide">Loading session…</p>
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
  );
}

export default App;
