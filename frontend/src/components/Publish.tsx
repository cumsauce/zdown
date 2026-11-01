import { useMemo, useState } from 'react';
import { api, ApiError, providerLabel, type Repo } from '../api';
import { siteStore, useSite } from '../lib/store';
import { notifyError, notifyOk } from '../notify';
import { tokens } from '../theme';
import { Icon } from './icons';
import { Badge, Banner, Btn, Muted, Path, Sheet } from './ui';

const STATUS: Record<string, string> = { A: 'New', M: 'Edited', D: 'Removed' };

/** What goes out, in plain words, before anything is pushed. */
export function PublishSheet({ repo, onClose }: { repo: Repo; onClose(): void }) {
  const { data, conflicts } = useSite(repo.id);
  const [busy, setBusy] = useState(false);
  const titles = useMemo(() => new Map((data?.posts ?? []).map((p) => [p.path, p])), [data]);
  const changed = data?.status.changed ?? [];
  const drafts = changed.filter((c) => titles.get(c.path)?.draft).length;

  const publish = async () => {
    setBusy(true);
    try {
      const r = await api.publish(repo.id);
      notifyOk(`Published to ${providerLabel(repo.provider)} (${r.pushed.slice(0, 7)})`);
      await siteStore.load(repo.id);
      onClose();
    } catch (e) {
      const list = e instanceof ApiError ? (e.data as { conflicts?: string[] } | null)?.conflicts : undefined;
      if (list?.length) siteStore.setConflicts(repo.id, list);
      else notifyError(e);
    } finally { setBusy(false); }
  };

  return (
    <Sheet title={`Publish to ${repo.default_branch}`} onClose={onClose} footer={
      conflicts.length ? undefined : (
        <>
          <Btn kind="ghost" onClick={onClose}>Not yet</Btn>
          <Btn kind="primary" icon="upload" loading={busy} disabled={!changed.length} onClick={() => void publish()}>Publish</Btn>
        </>
      )
    }>
      {conflicts.length > 0 ? <ConflictBox repo={repo} onDone={() => undefined} /> : changed.length === 0 ? (
        <Muted>Nothing to publish. Everything here is already on {providerLabel(repo.provider)}.</Muted>
      ) : (
        <>
          <Muted>Pushes these changes to {repo.full_name} on {providerLabel(repo.provider)}:</Muted>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {changed.map((c) => (
              <div key={c.path} style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <Badge $tone={c.status === 'D' ? 'negative' : 'muted'}>{STATUS[c.status] ?? c.status}</Badge>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: tokens.fg }}>{titles.get(c.path)?.title ?? c.path.split('/').pop()}</div>
                  <Path>{c.path}</Path>
                </div>
              </div>
            ))}
          </div>
          {drafts > 0 && (
            <Banner $tone="warning" style={{ borderRadius: 8 }}>
              <Icon name="alert" size={17} />
              {drafts === 1 ? 'One is a draft, so it' : `${drafts} are drafts, so they`} won't appear on the site until the draft flag is off.
            </Banner>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Both sides changed the same text: make the decision easy to understand and hard to regret. */
export function ConflictBox({ repo, onDone }: { repo: Repo; onDone(): void }) {
  const { conflicts, data } = useSite(repo.id);
  const [busy, setBusy] = useState<'mine' | 'theirs' | null>(null);
  const titles = new Map((data?.posts ?? []).map((p) => [p.path, p.title]));
  const resolve = async (side: 'mine' | 'theirs') => {
    setBusy(side);
    await siteStore.sync(repo.id, repo, { force: true, resolve: side });
    await siteStore.load(repo.id);
    setBusy(null);
    onDone();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, color: tokens.fgSoft, lineHeight: 1.5 }}>
        {conflicts.length === 1 ? 'This file was' : `These ${conflicts.length} files were`} changed both here and on {providerLabel(repo.provider)}. Choose which to keep. The other version stays in the history.
      </div>
      {conflicts.map((p) => (
        <div key={p} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, color: tokens.fg }}>{titles.get(p) ?? p.split('/').pop()}</div>
          <Path>{p}</Path>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn kind="primary" loading={busy === 'mine'} disabled={!!busy} onClick={() => void resolve('mine')}>Keep my version</Btn>
        <Btn loading={busy === 'theirs'} disabled={!!busy} onClick={() => void resolve('theirs')}>Use {providerLabel(repo.provider)}'s</Btn>
      </div>
    </div>
  );
}
