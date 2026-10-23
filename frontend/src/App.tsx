import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from 'baseui/spinner';
import { AuthProvider, useAuth } from './auth';
import { Center } from './components/ui';
import { AppShell } from './components/AppShell';
import { Landing } from './pages/Landing';
import { Home } from './pages/Home';
import { Repos } from './pages/Repos';
import { Posts } from './pages/Posts';
import { Editor } from './pages/Editor';
import { Versions } from './pages/Versions';
import { Settings } from './pages/Settings';

/** Signed-in routes all live inside the one AppShell (sidebar + content). */
function Shelled() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Center><Spinner $size="24px" /></Center>;
  if (!me) return loc.pathname === '/' ? <Landing /> : <Navigate to="/" replace state={{ from: loc.pathname }} />;
  const editing = /^\/repos\/\d+\/edit$/.test(loc.pathname);
  return (
    <AppShell bare={editing}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/repos" element={<Repos />} />
        <Route path="/repos/:repoId" element={<Posts />} />
        <Route path="/repos/:repoId/edit" element={<Editor />} />
        <Route path="/repos/:repoId/versions" element={<Versions />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
