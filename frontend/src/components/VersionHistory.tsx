import { useEffect, useState } from 'react';
import { styled } from 'baseui';
import { Button, KIND, SIZE } from 'baseui/button';
import { api, errorMessage, type Version } from '../api';
import { relTime, shortSha } from '../lib/time';
import { tokens } from '../theme';
import { DiffView } from './DiffView';
import { CardHead, CardTitle, ErrorText, Full, Hint, Panel, Row } from './ui';

// git's well-known empty tree: the left side when diffing a file's first version
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const Layout = styled('div', {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)',
  gap: '16px',
  alignItems: 'start',
  '@media (max-width: 639px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
});

const Commit = styled<'button', { $active: boolean }>('button', ({ $active }) => ({
  appearance: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  width: '100%',
  textAlign: 'left',
  cursor: 'pointer',
  padding: '10px 16px',
  border: 'none',
  borderBottom: `1px solid ${tokens.rowRule}`,
  backgroundColor: $active ? tokens.active : 'transparent',
  boxShadow: $active ? `inset 2px 0 0 ${tokens.accent}` : 'none',
  color: tokens.fgSoft,
  fontSize: '13px',
  fontFamily: 'inherit',
  ':hover': { backgroundColor: $active ? tokens.active : tokens.hover },
}));

const Sha = styled('span', { fontFamily: tokens.mono, fontSize: '11px', color: tokens.accent });
const Meta = styled('span', { fontFamily: tokens.mono, fontSize: '11px', color: tokens.fgMuted });

export function VersionHistory({ repoId, path, versions, restoring, onRestore }: {
  repoId: number;
  path: string;
  versions: Version[];
  restoring: boolean;
  onRestore(v: Version): Promise<boolean>;
}) {
  const [sel, setSel] = useState<Version | null>(null);
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

  return (
    <Layout>
      <Panel style={{ padding: 0 }}>
        <CardHead>
          <CardTitle>Versions</CardTitle>
          <Hint>{versions.length}</Hint>
        </CardHead>
        {versions.length === 0 && <div style={{ padding: 16 }}><Hint>no commits touch this file yet</Hint></div>}
        {versions.map((v, i) => (
          <Commit key={v.sha} $active={sel?.sha === v.sha} onClick={() => setSel(v)}>
            <span>{v.subject}</span>
            <Row style={{ gap: 8 }}>
              <Sha>{shortSha(v.sha)}</Sha>
              <Meta>{relTime(v.time)} · {v.author}{i === 0 ? ' · head' : ''}</Meta>
            </Row>
          </Commit>
        ))}
      </Panel>
      <Panel style={{ padding: 0, minWidth: 0 }}>
        {sel ? (
          <>
            <Row style={{ padding: '12px 16px', borderBottom: `1px solid ${tokens.border}`, minHeight: 52 }}>
              <Sha>{shortSha(sel.sha)}</Sha>
              <Meta>{sel.subject}</Meta>
              <Full />
              <Button size={SIZE.mini} kind={KIND.secondary} isLoading={restoring}
                onClick={() => void onRestore(sel).then((ok) => { if (ok) { setSel(null); setDiff(null); } })}>
                restore this version
              </Button>
            </Row>
            <div style={{ padding: '12px 0' }}>
              {busy && <div style={{ padding: '0 12px' }}><Hint>computing diff…</Hint></div>}
              {err && <div style={{ padding: '0 12px' }}><ErrorText>{err}</ErrorText></div>}
              {diff !== null && (diff ? <DiffView diff={diff} /> : <div style={{ padding: '0 12px' }}><Hint>no changes to this file</Hint></div>)}
            </div>
          </>
        ) : (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}><Hint>select a commit to see what changed</Hint></div>
        )}
      </Panel>
    </Layout>
  );
}
