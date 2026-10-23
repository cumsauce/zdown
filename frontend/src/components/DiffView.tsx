export function DiffView({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, '').split('\n');
  return (
    <div className="diff">
      {lines.map((l, i) => {
        let cls = '';
        if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('@@') || l.startsWith('diff ') || l.startsWith('index ')) cls = 'meta';
        else if (l.startsWith('+')) cls = 'add';
        else if (l.startsWith('-')) cls = 'del';
        return <div key={i} className={cls}>{l || ' '}</div>;
      })}
    </div>
  );
}
