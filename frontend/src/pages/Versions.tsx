import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Spinner } from 'baseui/spinner';
import { api, errorMessage, type Version } from '../api';
import { VersionHistory } from '../components/VersionHistory';
import { ErrorText, MonoText, Page, PageHeader } from '../components/ui';
import { notifyError, notifyOk } from '../notify';
import { shortSha } from '../lib/time';
import { tokens } from '../theme';

export function Versions() {
  const repoId = Number(useParams().repoId);
  const path = useSearchParams()[0].get('path') ?? '';
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(() => {
    api.versions(repoId, path).then(setVersions, (e) => setError(errorMessage(e)));
  }, [repoId, path]);
  useEffect(load, [load]);

  // Restore = a new commit with the old content; history is never rewritten.
  const restore = async (v: Version) => {
    if (!window.confirm(`restore ${path} to ${shortSha(v.sha)}?\nthe current content stays in history.`)) return false;
    setRestoring(true);
    try {
      const [old, cur] = await Promise.all([api.contentAt(repoId, v.sha, path), api.post(repoId, path)]);
      await api.save(repoId, { path, content: old.content, base_blob: cur.blob, message: `Revert ${path} to ${shortSha(v.sha)}` });
      notifyOk(`restored ${shortSha(v.sha)}`);
      load();
      return true;
    } catch (e) { notifyError(e); return false; }
    finally { setRestoring(false); }
  };

  return (
    <Page style={{ maxWidth: 1200 }}>
      <PageHeader
        back={{ to: `/repos/${repoId}/edit?path=${encodeURIComponent(path)}`, label: 'back to editor' }}
        title="History"
        meta={<MonoText style={{ fontSize: 11, color: tokens.fgMuted }}>{path}</MonoText>} />
      {error ? <ErrorText>{error}</ErrorText> : versions === null ? <Spinner $size="24px" /> : (
        <VersionHistory repoId={repoId} path={path} versions={versions} restoring={restoring} onRestore={restore} />
      )}
    </Page>
  );
}
