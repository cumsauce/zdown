import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from 'baseui/spinner';
import { AuthProvider, useAuth } from './auth';
import { Center } from './components/ui';
import { TopBar } from './components/TopBar';
import { Landing } from './pages/Landing';
import { Repos } from './pages/Repos';
import { Posts } from './pages/Posts';
import { Editor } from './pages/Editor';
import { Versions } from './pages/Versions';
import { Settings } from './pages/Settings';

function Gate({ children, bar = true }: { children: React.ReactNode; bar?: boolean }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Center><Spinner $size="24px" /></Center>;
  if (!me) return <Navigate to="/" replace state={{ from: loc.pathname }} />;
  return <>{bar && <TopBar />}{children}</>;
}

function Home() {
  const { me, loading } = useAuth();
  if (loading) return <Center><Spinner $size="24px" /></Center>;
  return me ? <Navigate to="/repos" replace /> : <Landing />;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/repos" element={<Gate><Repos /></Gate>} />
        <Route path="/repos/:repoId" element={<Gate><Posts /></Gate>} />
        <Route path="/repos/:repoId/edit" element={<Gate bar={false}><Editor /></Gate>} />
        <Route path="/repos/:repoId/versions" element={<Gate><Versions /></Gate>} />
        <Route path="/settings" element={<Gate><Settings /></Gate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
