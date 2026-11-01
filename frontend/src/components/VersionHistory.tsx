import { useEffect, useState } from 'react';
import { styled } from 'styletron-react';
import { api, errorMessage, type Version } from '../api';
import { relTime, shortSha } from '../lib/time';
import { HOVER, PHONE, tokens } from '../theme';
import { DiffView } from './DiffView';
import { Btn, Grow, Muted, Spinner } from './ui';

// git's well-known empty tree: the left side when diffing a file's first version
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const Layout = styled('div', {
  display: 'grid',
  gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)',
  gap: '24px',
  alignItems: 'start',
  [PHONE]: { gridTemplateColumns: 'minmax(0, 1fr)' },
});

const Commit = styled<'button', { $active: boolean }>('button', ({ $active }) => ({
  appearance: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  width: '100%',
  textAlign: 'left',
  cursor: 'pointer',
  padding: '10px 10px',
  border: 'none',
  borderRadius: '8px',
  backgroundColor: $active ? tokens.active : 'transparent',
  color: tokens.fg,
  fontSize: '14px',
  [HOVER]: { ':hover': { backgroundColor: $active ? tokens.active : tokens.hover } },
}));

const Diff = styled('div', { minWidth: 0, border: `1px solid ${tokens.rule}`, borderRadius: '10px', overflow: 'hidden' });

const describe = (subject: string) => {
  if (/^Update /.test(subject)) return 'Edited';
  if (/^Create /.test(subject)) return 'Created';
  if (/^Revert /.test(subject)) return 'Restored an earlier version';
  if (/^Rename /.test(subject)) return 'Renamed';
  if (/^Merge /.test(subject)) return 'Merged changes from the remote';
  return subject;
};

export function VersionHistory({ repoId, path, versions, restoring, onRestore }: {
  repoId: number;
  path: string;
  versions: Version[];
  restoring: boolean;
  onRestore(v: Version): Promise<boolean>;
}) {
  const [sel, setSel] = useState<Version | null>(versions[0] ?? null);
  const [diff, setDiff] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sel) return;
    // diff against the previous version *of this file* (the next older entry)
    const i = versions.findIndex((v) => v.sha === sel.sha);
    const prev = versions[i + 1];
    let cancelled = false;
    setBusy(true); setErr(null); setDiff(null);
    api.diff(repoId, `${prev ? prev.sha : EMPTY_TREE}..${sel.sha}`, path)
      .then((d) => { if (!cancelled) setDiff(d.diff); }, (e) => { if (!cancelled) setErr(errorMessage(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [sel, versions, repoId, path]);

  if (versions.length === 0) return <Muted>No versions of this file yet.</Muted>;

  const isHead = sel?.sha === versions[0]?.sha;
  return (
    <Layout>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {versions.map((v, i) => (
          <Commit key={v.sha} type="button" $active={sel?.sha === v.sha} onClick={() => setSel(v)}>
            <span>{describe(v.subject)}{i === 0 ? ' (current)' : ''}</span>
            <Muted>{relTime(v.time)} · {v.author}</Muted>
          </Commit>
        ))}
      </div>
      {sel && (
        <Diff>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${tokens.rule}`, flexWrap: 'wrap' }}>
            <Grow><Muted>{shortSha(sel.sha)} · {new Date(sel.time * 1000).toLocaleString()}</Muted></Grow>
            {!isHead && (
              <Btn small loading={restoring} onClick={() => void onRestore(sel).then((ok) => { if (ok) { setSel(null); setDiff(null); } })}>Restore this version</Btn>
            )}
          </div>
          <div style={{ padding: '10px 0' }}>
            {busy && <div style={{ padding: '0 14px' }}><Spinner size={14} /></div>}
            {err && <div style={{ padding: '0 14px', color: tokens.negative, fontSize: 13 }}>{err}</div>}
            {diff !== null && (diff ? <DiffView diff={diff} /> : <div style={{ padding: '0 14px' }}><Muted>No changes to this file.</Muted></div>)}
          </div>
        </Diff>
      )}
    </Layout>
  );
}
