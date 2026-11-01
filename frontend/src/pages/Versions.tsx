import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage, type Version } from '../api';
import { Icon } from '../components/icons';
import { VersionHistory } from '../components/VersionHistory';
import { Banner, confirmDialog, H1, Loading, Page, Path, quietLink, styled } from '../components/ui';
import { siteStore } from '../lib/store';
import { notifyError, notifyOk } from '../notify';
import { relTime, shortSha } from '../lib/time';

const BackLink = styled(Link, { ...quietLink, marginLeft: '-4px', alignSelf: 'flex-start' });

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
    const ok = await confirmDialog({
      title: 'Restore this version?',
      body: `The post goes back to how it was ${relTime(v.time)}. The current text stays in the history.`,
      action: 'Restore',
    });
    if (!ok) return false;
    setRestoring(true);
    try {
      const [old, cur] = await Promise.all([api.contentAt(repoId, v.sha, path), api.post(repoId, path)]);
      await api.save(repoId, { path, content: old.content, base_blob: cur.blob, message: `Revert ${path} to ${shortSha(v.sha)}` });
      notifyOk('Restored');
      void siteStore.load(repoId);
      load();
      return true;
    } catch (e) { notifyError(e); return false; }
    finally { setRestoring(false); }
  };

  return (
    <Page style={{ maxWidth: 1040 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <BackLink to={`/repos/${repoId}/edit?path=${encodeURIComponent(path)}`}>
          <Icon name="back" size={17} />Back to the post
        </BackLink>
        <H1>History</H1>
        <Path>{path}</Path>
      </div>
      {error ? <Banner $tone="negative" style={{ borderRadius: 8 }}>{error}</Banner> : versions === null ? <Loading /> : (
        <VersionHistory repoId={repoId} path={path} versions={versions} restoring={restoring} onRestore={restore} />
      )}
    </Page>
  );
}
