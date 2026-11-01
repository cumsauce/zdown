import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Loading } from './components/ui';
import { AppShell } from './components/AppShell';
import { Landing } from './pages/Landing';
import { Home } from './pages/Home';
import { Repos } from './pages/Repos';
import { Posts } from './pages/Posts';
import { Settings } from './pages/Settings';

// The editor (CodeMirror and the renderer) is most of the code; lists shouldn't wait for it.
const EditorRoute = lazy(() => import('./pages/Editor').then((m) => ({ default: m.EditorRoute })));
const Versions = lazy(() => import('./pages/Versions').then((m) => ({ default: m.Versions })));

/** Signed-in routes all live inside the one AppShell. */
function Shelled() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!me) return loc.pathname === '/' ? <Landing /> : <Navigate to="/" replace state={{ from: loc.pathname }} />;
  const editing = /^\/repos\/\d+\/edit$/.test(loc.pathname);
  return (
    <AppShell bare={editing}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/repos" element={<Repos />} />
          <Route path="/repos/:repoId" element={<Posts />} />
          <Route path="/repos/:repoId/edit" element={<EditorRoute />} />
          <Route path="/repos/:repoId/versions" element={<Versions />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Shelled />
    </AuthProvider>
  );
}
