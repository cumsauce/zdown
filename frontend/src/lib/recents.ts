// Recently opened files, per device (localStorage). The sidebar's "Recent"
// list reads this; the editor writes it on open and when the title changes.
import { useEffect, useState } from 'react';

export interface Recent { repoId: number; path: string; title: string | null; at: number }

const KEY = 'zdown.recents';
const MAX = 30;
const EVT = 'zdown:recents';

function read(): Recent[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Recent[]; } catch { return []; }
}

function write(list: Recent[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVT));
}

export const recents = {
  touch(repoId: number, path: string, title: string | null) {
    const rest = read().filter((r) => !(r.repoId === repoId && r.path === path));
    write([{ repoId, path, title, at: Date.now() }, ...rest]);
  },
  /** Update the title without moving the entry to the top. */
  retitle(repoId: number, path: string, title: string | null) {
    const list = read();
    const r = list.find((x) => x.repoId === repoId && x.path === path);
    if (!r || r.title === title) return;
    r.title = title;
    write(list);
  },
  remove(repoId: number, path: string) { write(read().filter((r) => !(r.repoId === repoId && r.path === path))); },
  dropRepo(repoId: number) { write(read().filter((r) => r.repoId !== repoId)); },
};

export function useRecents(): Recent[] {
  const [list, setList] = useState(read);
  useEffect(() => {
    const on = () => setList(read());
    window.addEventListener(EVT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVT, on); window.removeEventListener('storage', on); };
  }, []);
  return list;
}

export const editUrl = (repoId: number, path: string) => `/repos/${repoId}/edit?path=${encodeURIComponent(path)}`;
