const paths: Record<string, string> = {
  book: "M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3z",
  map: "M5 4h5v5H5z M15 15h5v5h-5z M3 15h5v5H3z M7 9v3h10v3 M5 15v-3",
  table: "M3 4h18v16H3z M3 10h18 M10 4v16",
  check: "m5 12 4 4L19 6",
  alert: "m12 3 10 18H2z M12 9v5 M12 17h.01",
  folder: "M3 6h7l2 2h9v12H3z",
  upload: "M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6",
  download: "M12 3v13 m-5-5 5 5 5-5 M4 16v5h16v-5",
  arrow: "M4 12h16 m-6-6 6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  code: "m8 7-5 5 5 5 m8-10 5 5-5 5 M14 4l-4 16",
  search: "M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
  lock: "M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4",
  spark: "m12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2z",
  undo: "M4 10h9a7 7 0 0 1 0 14 M4 10l5-5 M4 10l5 5",
  close: "m6 6 12 12 M6 18 18 6",
  play: "m8 4 13 8-13 8z",
  file: "M5 3h9l5 5v13H5z M14 3v6h5 M9 13h6 M9 17h6",
  history: "M3 10a9 9 0 1 1 1 8 M3 3v7h7 M12 7v6l4 2",
  external: "M14 3h7v7 M21 3 11 13 M10 3H3v18h18v-7",
  info: "M12 17v-6 M12 7h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  reset: "M3 10a9 9 0 1 1 2 9 M3 3v7h7",
  plus: "M12 4v16 M4 12h16",
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.file} />
    </svg>
  );
}
