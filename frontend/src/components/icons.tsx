// A small hand-drawn set on one 20px grid, so every icon has the same weight.
const paths: Record<string, React.ReactNode> = {
  home: <path d="M3.5 9 10 3.5 16.5 9v7a.8.8 0 0 1-.8.8H12v-5H8v5H4.3a.8.8 0 0 1-.8-.8z" />,
  folder: <path d="M2.8 5.3c0-.6.5-1 1-1h3.7l1.8 2h6.9c.6 0 1 .4 1 1v7.4c0 .6-.4 1-1 1H3.8c-.5 0-1-.4-1-1z" />,
  plus: <path d="M10 4v12M4 10h12" />,
  user: <><circle cx="10" cy="7" r="3.2" /><path d="M3.8 16.8c.7-3 3.2-4.6 6.2-4.6s5.5 1.6 6.2 4.6" /></>,
  back: <path d="M12.5 4 6.5 10l6 6" />,
  forward: <path d="m7.5 4 6 6-6 6" />,
  down: <path d="m4.5 7.5 5.5 5.5 5.5-5.5" />,
  more: <><circle cx="4.5" cy="10" r="1.1" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" /><circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none" /></>,
  close: <path d="m5 5 10 10M15 5 5 15" />,
  eye: <><path d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10z" /><circle cx="10" cy="10" r="2.4" /></>,
  pen: <path d="M13.6 3.6a1.9 1.9 0 0 1 2.8 2.8L6.6 16.2l-3.6.8.8-3.6z" />,
  sliders: <path d="M3 6h7.5M14.5 6H17M3 14h2.5M9.5 14H17M12.5 4v4M7.5 12v4" />,
  sync: <path d="M16.5 8.5A6.7 6.7 0 0 0 4.4 6.6L3 8.2M3.5 11.5a6.7 6.7 0 0 0 12.1 1.9L17 11.8M3 4v4.2h4.2M17 16v-4.2h-4.2" />,
  upload: <path d="M10 13V3.8M6 7.3l4-3.8 4 3.8M3.5 12.5v3c0 .8.7 1.5 1.5 1.5h10c.8 0 1.5-.7 1.5-1.5v-3" />,
  search: <><circle cx="9" cy="9" r="5.2" /><path d="m13 13 3.8 3.8" /></>,
  sidebar: <><rect x="2.8" y="3.8" width="14.4" height="12.4" rx="1.6" /><path d="M7.5 3.8v12.4" /></>,
  link: <path d="M8.5 11.5a3.3 3.3 0 0 0 4.7 0l2.4-2.4a3.3 3.3 0 0 0-4.7-4.7l-1 1M11.5 8.5a3.3 3.3 0 0 0-4.7 0l-2.4 2.4a3.3 3.3 0 0 0 4.7 4.7l1-1" />,
  image: <><rect x="2.8" y="3.8" width="14.4" height="12.4" rx="1.6" /><circle cx="7" cy="8" r="1.3" /><path d="m3 14.5 4-3.7 3 2.7 2.8-2.5 4.2 3.7" /></>,
  list: <path d="M8 5.5h9M8 10h9M8 14.5h9M3.6 5.5h.01M3.6 10h.01M3.6 14.5h.01" />,
  numbered: <><path d="M8.5 5.5h8.5M8.5 10h8.5M8.5 14.5h8.5" /><path d="M3 4.3 4.3 3.6v3.9M3 12.6c.3-.6 1.9-.9 2 .2 0 1.1-2 1.3-2 3h2.2" strokeWidth="1.2" /></>,
  task: <><rect x="3" y="3.5" width="5.5" height="5.5" rx="1" /><path d="m4.4 6.2 1 1 1.7-1.9M11.5 6h5.5M11.5 14h5.5" /><rect x="3" y="11.3" width="5.5" height="5.5" rx="1" /></>,
  quote: <path d="M8 6.2C5.6 6.5 4 8.2 4 10.5V14h4v-3.8H5.7M16 6.2c-2.4.3-4 2-4 4.3V14h4v-3.8h-2.3" />,
  code: <path d="m7 6-4 4 4 4M13 6l4 4-4 4" />,
  indent: <path d="M9 5.5h8M9 10h8M9 14.5h8M3 7l3 3-3 3" />,
  outdent: <path d="M9 5.5h8M9 10h8M9 14.5h8M6 7l-3 3 3 3" />,
  undo: <path d="M7 4 3.5 7.5 7 11M3.5 7.5h8a4.5 4.5 0 0 1 0 9H8" />,
  redo: <path d="m13 4 3.5 3.5L13 11M16.5 7.5h-8a4.5 4.5 0 0 0 0 9H12" />,
  keyboard: <><rect x="2.5" y="3.5" width="15" height="9" rx="1.4" /><path d="M5.5 6.5h.01M8.5 6.5h.01M11.5 6.5h.01M14.5 6.5h.01M6.5 9.5h7M7.5 15l2.5 2 2.5-2" /></>,
  puzzle: <path d="M8 3.5a1.8 1.8 0 0 1 3.6 0v1.3H16v4.4h-1.3a1.8 1.8 0 0 0 0 3.6H16v4.4H4v-4.4h1.3a1.8 1.8 0 0 0 0-3.6H4V4.8h4z" />,
  table: <><rect x="2.8" y="3.8" width="14.4" height="12.4" rx="1.6" /><path d="M2.8 8.2h14.4M2.8 12.2h14.4M8.2 8.2v8" /></>,
  rule: <path d="M3 10h14" />,
  review: <path d="M3 5.5h14M3 10h7M3 14.5h5.5M12 14.2l2.2 2.3 3.8-4.7" />,
  note: <path d="M5 2.8h7l3.2 3.2V17H5zM12 2.8V6h3.2M7.5 9.5h5M7.5 12.5h5" />,
  history: <path d="M3.3 10a6.7 6.7 0 1 0 2-4.7L3.3 7.3M3.3 3.5v3.8h3.8M10 6.5V10l2.5 1.5" />,
  trash: <path d="M3.5 5.5h13M8 5.5V3.8h4v1.7M5 5.5l.8 11h8.4l.8-11M8.3 8.5v5M11.7 8.5v5" />,
  check: <path d="m4 10.5 4 4 8-9" />,
  alert: <><path d="M10 3.3 2.4 16.5h15.2z" /><path d="M10 8.5v3.5M10 14.3h.01" /></>,
  external: <path d="M8 4H4.5A1.5 1.5 0 0 0 3 5.5v10A1.5 1.5 0 0 0 4.5 17h10a1.5 1.5 0 0 0 1.5-1.5V12M11 3h6v6M17 3l-8 8" />,
  sun: <><circle cx="10" cy="10" r="3.4" /><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7 6 6M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3" /></>,
  moon: <path d="M16.5 11.7A6.8 6.8 0 0 1 8.3 3.5a6.8 6.8 0 1 0 8.2 8.2z" />,
  rename: <path d="M3 16.5h14M6 13l1-3.5 6.5-6.5a1.5 1.5 0 0 1 2 2L9 11.5z" />,
  logout: <path d="M12.5 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h7.5M9 10h8.5M14.5 7l3 3-3 3" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      {paths[name]}
    </svg>
  );
}
