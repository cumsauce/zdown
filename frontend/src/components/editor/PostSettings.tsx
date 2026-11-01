import { useEffect, useMemo, useState } from 'react';
import { styled } from 'styletron-react';
import { dateText, parseFields, setField, splitDoc, withFrontMatter } from '../../lib/frontmatter';
import { slugify } from '../../lib/site';
import { COARSE, tokens } from '../../theme';
import { Btn, Field, Grow, H2, Input, MonoTextarea, Path, Row, Select, Textarea } from '../ui';

// Every field writes straight into the front matter, line by line, and saves
// like any other edit. Keys it doesn't know about stay exactly as written, and
// the raw block is always there for anything the form doesn't cover.

const Toggle = styled('label', {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  fontSize: '14px',
  color: tokens.fgSoft,
  cursor: 'pointer',
  minHeight: '36px',
  [COARSE]: { minHeight: '44px' },
});

const scalar = (v: unknown) => ['string', 'number', 'boolean'].includes(typeof v);

function literalOf(v: string): string | boolean | number {
  if (v === 'true' || v === 'false') return v === 'true';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function PostSettings({ content, path, isSection, onChange, onRename, canRename }: {
  content: string;
  path: string | null;
  isSection: boolean;
  onChange(next: string): void;
  onRename(slug: string): Promise<void>;
  canRename: boolean;
}) {
  const doc = useMemo(() => splitDoc(content), [content]);
  const fields = useMemo(() => parseFields(doc), [doc]);
  const [raw, setRaw] = useState(doc.raw ?? '');
  const [rawOpen, setRawOpen] = useState(fields === null);
  useEffect(() => { setRaw(doc.raw ?? ''); }, [doc.raw]);

  const currentSlug = useMemo(() => {
    if (!path) return '';
    const parts = path.split('/');
    const base = parts[parts.length - 1];
    return /^index\.[a-z]+$/i.test(base) ? parts[parts.length - 2] : base.replace(/\.\w+$/, '');
  }, [path]);
  const [slug, setSlug] = useState(currentSlug);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { setSlug(currentSlug); }, [currentSlug]);

  const set = (table: string | null, key: string, value: string | boolean | number | string[] | null) =>
    onChange(setField(content, table, key, value));

  if (fields === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14, color: tokens.negative }}>This front matter doesn't parse, so Zola would refuse to build this page. Fix it here.</div>
        <MonoTextarea rows={12} value={raw} spellCheck={false} aria-label="Raw front matter"
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setRaw(e.currentTarget.value); onChange(withFrontMatter(content, e.currentTarget.value)); }} />
      </div>
    );
  }

  const str = (k: string) => (scalar(fields[k]) ? String(fields[k]) : '');
  const tax = (fields.taxonomies && typeof fields.taxonomies === 'object' ? fields.taxonomies : {}) as Record<string, unknown>;
  const extra = (fields.extra && typeof fields.extra === 'object' ? fields.extra : {}) as Record<string, unknown>;
  const taxNames = [...new Set(['tags', ...Object.keys(tax)])];
  const dateValue = dateText(fields.date);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateValue);
  const nonScalarExtra = Object.values(extra).some((v) => !scalar(v));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field>Description
        <Textarea rows={2} value={str('description')} placeholder="Shown in listings and link previews"
          onChange={(e) => set(null, 'description', e.currentTarget.value || null)} />
      </Field>

      {!isSection && (
        <>
          <Field>Date
            <Input type={dateOnly || !dateValue ? 'date' : 'text'} value={dateValue}
              onChange={(e) => set(null, 'date', e.currentTarget.value || null)} />
          </Field>
          <Toggle>
            <input type="checkbox" checked={fields.draft === true} style={{ accentColor: 'var(--accent)', width: 18, height: 18 }}
              onChange={(e) => set(null, 'draft', e.currentTarget.checked ? true : null)} />
            Draft: Zola won't build this page
          </Toggle>
          {taxNames.map((name) => (
            <Field key={name}>{name[0].toUpperCase() + name.slice(1)}
              <Input defaultValue={Array.isArray(tax[name]) ? (tax[name] as unknown[]).join(', ') : ''} placeholder="Comma, separated"
                onBlur={(e) => {
                  const vals = e.currentTarget.value.split(',').map((s) => s.trim()).filter(Boolean);
                  const before = Array.isArray(tax[name]) ? (tax[name] as unknown[]).map(String) : [];
                  if (vals.join('\0') !== before.join('\0')) set('taxonomies', name, vals.length ? vals : null);
                }} />
            </Field>
          ))}
        </>
      )}

      {isSection && (
        <Field>Sort pages by
          <Select value={str('sort_by') || 'none'} onChange={(e) => set(null, 'sort_by', e.currentTarget.value === 'none' ? null : e.currentTarget.value)}>
            <option value="none">Zola's default (no order)</option>
            <option value="date">Date, newest first</option>
            <option value="update_date">Last updated</option>
            <option value="title">Title</option>
            <option value="weight">Weight</option>
            <option value="slug">Slug</option>
          </Select>
        </Field>
      )}
      {(fields.weight !== undefined) && (
        <Field>Weight
          <Input type="number" value={str('weight')} onChange={(e) => set(null, 'weight', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} />
        </Field>
      )}

      {Object.keys(extra).length > 0 && !nonScalarExtra && (
        <>
          <H2 style={{ marginTop: 6 }}>Extra</H2>
          {Object.entries(extra).map(([k, v]) => (
            <Field key={k}>{k}
              <Input value={String(v)} onChange={(e) => set('extra', k, literalOf(e.currentTarget.value))} />
            </Field>
          ))}
        </>
      )}

      {canRename && path && !isSection && (
        <Field>Slug (the page's URL)
          <Row>
            <Grow><Input value={slug} spellCheck={false} autoCapitalize="none" aria-label="Slug" onChange={(e) => setSlug(e.currentTarget.value)} /></Grow>
            <Btn loading={renaming} disabled={!slugify(slug) || slugify(slug) === currentSlug}
              onClick={() => { setRenaming(true); void onRename(slugify(slug)).finally(() => setRenaming(false)); }}>Rename</Btn>
          </Row>
          <Path>{path}</Path>
        </Field>
      )}

      <div>
        <Btn kind="ghost" small onClick={() => setRawOpen(!rawOpen)} style={{ marginLeft: -10 }}>{rawOpen ? 'Hide' : 'Edit'} raw front matter</Btn>
        {rawOpen && (
          <MonoTextarea rows={Math.max(6, raw.split('\n').length + 1)} value={raw} spellCheck={false} aria-label="Raw front matter" style={{ marginTop: 6 }}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setRaw(e.currentTarget.value); onChange(withFrontMatter(content, e.currentTarget.value)); }} />
        )}
      </div>
    </div>
  );
}
