import { useMemo, useState } from 'react';
import { styled } from 'baseui';
import { Button, KIND, SIZE } from 'baseui/button';
import { Checkbox } from 'baseui/checkbox';
import { joinFrontMatter, setTomlKey, splitFrontMatter, tomlLiteral, tryParseToml } from '../lib/frontmatter';
import { tokens } from '../theme';
import { Full, Hint, Row, TextInput } from './ui';

const Sheet = styled('div', {
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  '@media (max-width: 639px)': { padding: '12px' },
});

const Field = styled('label', {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  fontFamily: tokens.mono,
  fontSize: '11px',
  color: tokens.fgMuted,
  minWidth: 0,
});

const Grid = styled('div', { display: 'flex', flexWrap: 'wrap', gap: '12px' });

interface Pair { k: string; v: string }

const str = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined || v === null) return '';
  return String(v);
};
const scalar = (v: unknown) => ['string', 'number', 'boolean'].includes(typeof v) || v instanceof Date;
const guessLiteral = (v: string) =>
  /^(true|false)$/.test(v) || /^-?\d+(\.\d+)?$/.test(v) ? v : tomlLiteral(v);

const MINI = { size: SIZE.mini } as const;

export function FrontMatterSheet({ content, onApply, onClose }: {
  content: string;
  onApply(next: string): void;
  onClose(): void;
}) {
  const { toml } = splitFrontMatter(content);
  const parsed = useMemo(() => (toml === null ? {} : tryParseToml(toml)), [toml]);

  const fm = parsed ?? {};
  const taxIn = (fm.taxonomies && typeof fm.taxonomies === 'object' ? fm.taxonomies : {}) as Record<string, unknown>;
  const extraIn = (fm.extra && typeof fm.extra === 'object' ? fm.extra : {}) as Record<string, unknown>;

  const [title, setTitle] = useState(str(fm.title));
  const [description, setDescription] = useState(str(fm.description));
  const [date, setDate] = useState(str(fm.date));
  const [draft, setDraft] = useState(fm.draft === true);
  const [tax, setTax] = useState<Pair[]>(
    Object.entries(taxIn).map(([k, v]) => ({ k, v: Array.isArray(v) ? v.map(str).join(', ') : str(v) })),
  );
  const [extra, setExtra] = useState<Pair[]>(
    Object.entries(extraIn).filter(([, v]) => scalar(v)).map(([k, v]) => ({ k, v: str(v) })),
  );

  if (parsed === null) {
    return (
      <Sheet>
        <Hint style={{ color: tokens.warning }}>front matter isn't valid TOML — fix it in the text, then reopen settings.</Hint>
        <Row><Full /><Button {...MINI} kind={KIND.tertiary} onClick={onClose}>done</Button></Row>
      </Sheet>
    );
  }

  const apply = () => {
    let t = toml ?? '';
    // only lines whose value actually changed are touched
    const top = (key: string, before: unknown, lit: string | null) => {
      const prev = before === undefined ? null : scalar(before) ? tomlLiteral(str(before)) : '__complex__';
      if (prev === '__complex__') return;
      if (prev !== lit) t = setTomlKey(t, null, key, lit);
    };
    top('title', fm.title, title.trim() ? tomlLiteral(title) : null);
    top('description', fm.description, description.trim() ? tomlLiteral(description) : null);
    top('date', fm.date, date.trim() ? tomlLiteral(date.trim()) : null);
    if ((fm.draft === true) !== draft) t = setTomlKey(t, null, 'draft', draft ? 'true' : null);

    const taxOut = new Map(tax.filter((p) => p.k.trim()).map((p) => [p.k.trim(), p.v.split(',').map((s) => s.trim()).filter(Boolean)]));
    for (const k of Object.keys(taxIn)) if (!taxOut.has(k)) t = setTomlKey(t, 'taxonomies', k, null);
    for (const [k, vals] of taxOut) {
      const before = taxIn[k];
      if (!Array.isArray(before) || before.map(str).join('\u0000') !== vals.join('\u0000')) t = setTomlKey(t, 'taxonomies', k, tomlLiteral(vals));
    }

    const extraOut = new Map(extra.filter((p) => p.k.trim()).map((p) => [p.k.trim(), p.v]));
    for (const [k, v] of Object.entries(extraIn)) if (scalar(v) && !extraOut.has(k)) t = setTomlKey(t, 'extra', k, null);
    for (const [k, v] of extraOut) {
      if (str(extraIn[k]) !== v || !(k in extraIn)) t = setTomlKey(t, 'extra', k, guessLiteral(v));
    }
    onApply(joinFrontMatter(content, t));
  };

  const pairRows = (rows: Pair[], set: (p: Pair[]) => void, what: string, placeholder: string) =>
    rows.map((p, i) => (
      <Row key={i} style={{ flexWrap: 'nowrap' }}>
        <div style={{ width: '35%' }}>
          <TextInput aria-label="key" value={p.k} placeholder={what === 'taxonomy' ? 'tags' : 'key'}
            onChange={(e) => { const v = e.currentTarget.value; set(rows.map((r, j) => (j === i ? { ...r, k: v } : r))); }} />
        </div>
        <Full>
          <TextInput aria-label="value" value={p.v} placeholder={placeholder}
            onChange={(e) => { const v = e.currentTarget.value; set(rows.map((r, j) => (j === i ? { ...r, v } : r))); }} />
        </Full>
        <Button {...MINI} kind={KIND.tertiary} aria-label={`remove ${what} ${p.k}`} onClick={() => set(rows.filter((_, j) => j !== i))}>×</Button>
      </Row>
    ));

  return (
    <Sheet>
      <Grid>
        <Field style={{ flex: '1 1 140px' }}>title<TextInput value={title} onChange={(e) => setTitle(e.currentTarget.value)} /></Field>
        <Field style={{ flex: '1 1 140px' }}>date<TextInput value={date} placeholder="YYYY-MM-DD" onChange={(e) => setDate(e.currentTarget.value)} /></Field>
      </Grid>
      <Field>description<TextInput value={description} onChange={(e) => setDescription(e.currentTarget.value)} /></Field>
      <Checkbox checked={draft} onChange={(e) => setDraft(e.currentTarget.checked)}
        overrides={{ Label: { style: { fontFamily: tokens.mono, fontSize: '11px', color: tokens.fgMuted } } }}>
        draft
      </Checkbox>

      <div className="panel-title">taxonomies</div>
      {pairRows(tax, setTax, 'taxonomy', 'comma, separated')}
      <Row><Button {...MINI} kind={KIND.tertiary} onClick={() => setTax([...tax, { k: '', v: '' }])}>+ add</Button></Row>

      <div className="panel-title">extra</div>
      {pairRows(extra, setExtra, 'extra', 'value')}
      <Row><Button {...MINI} kind={KIND.tertiary} onClick={() => setExtra([...extra, { k: '', v: '' }])}>+ add</Button></Row>

      <Hint>other keys stay exactly as written in the +++ block</Hint>
      <Row style={{ position: 'sticky', bottom: 0, margin: '0 -16px -16px', padding: '12px 16px',
        backgroundColor: tokens.codeBg, borderTop: `1px solid ${tokens.border}` }}>
        <Full />
        <Button {...MINI} kind={KIND.tertiary} onClick={onClose}>done</Button>
        <Button {...MINI} kind={KIND.secondary} onClick={apply}>apply</Button>
      </Row>
    </Sheet>
  );
}
