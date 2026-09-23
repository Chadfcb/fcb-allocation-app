// The small green "New!" tag used everywhere in the app — sidebar sections,
// page links, and new buttons inside pages (see lib/newFeatures.ts).
// `inline` drops the auto left-margin used to push it to the right edge of
// a full-width sidebar row, for use inside a normal button.
export default function NewBadge({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={`${inline ? "ml-1.5" : "ml-auto"} shrink-0 rounded-full bg-[#6ABC46] px-1.5 py-0.5 text-[9px] font-bold leading-none text-black`}
    >
      New!
    </span>
  );
}
