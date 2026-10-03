/** "What to upload": do / don't examples, drawn as simple silhouettes. */
import type { ReactNode } from "react";

function Frame({ children, tone }: { children: ReactNode; tone: "good" | "bad" }) {
  return (
    <svg viewBox="0 0 60 90" className={`example example--${tone}`} aria-hidden="true">
      <rect x="1" y="1" width="58" height="88" rx="4" className="example__bg" />
      {children}
    </svg>
  );
}

const Person = ({ cx, top, s }: { cx: number; top: number; s: number }) => (
  <g className="example__person">
    <ellipse cx={cx} cy={top + 9 * s} rx={7 * s} ry={9 * s} />
    <path d={`M${cx - 20 * s} ${top + 40 * s} Q${cx - 18 * s} ${top + 20 * s} ${cx} ${top + 20 * s} Q${cx + 18 * s} ${top + 20 * s} ${cx + 20 * s} ${top + 40 * s} Z`} />
  </g>
);

const GOOD = (
  <Frame tone="good">
    <Person cx={30} top={12} s={1.35} />
  </Frame>
);

const GROUP = (
  <Frame tone="bad">
    <Person cx={14} top={40} s={0.6} />
    <Person cx={30} top={36} s={0.6} />
    <Person cx={46} top={40} s={0.6} />
  </Frame>
);

const ACTION = (
  <Frame tone="bad">
    <g className="example__person">
      <circle cx="34" cy="30" r="5" />
      <path d="M30 36 L38 36 L40 56 L44 72 L40 73 L35 58 L31 73 L27 72 L29 56 Z" />
      <path d="M38 40 L50 50 L48 52 L37 44 Z" />
    </g>
    <path d="M6 80 L54 80" className="example__ice" />
  </Frame>
);

const TINY = (
  <Frame tone="bad">
    <rect x="22" y="36" width="16" height="24" rx="2" className="example__tiny" />
    <g transform="translate(30 42) scale(0.3) translate(-30 -12)">
      <Person cx={30} top={12} s={1.35} />
    </g>
  </Frame>
);

export function UploadChecklist() {
  return (
    <section className="panel checklist" aria-labelledby="checklist-title">
      <h2 id="checklist-title" className="section-title">What to upload</h2>
      <div className="checklist__cols">
        <div className="checklist__col checklist__col--good">
          <div className="checklist__examples">{GOOD}</div>
          <ul>
            <li><b>One player per photo</b>, facing the camera</li>
            <li><b>Head and shoulders</b> visible, with some space above the head</li>
            <li><b>The original, full-size photo.</b> Don't crop or shrink it first. Bigger is better.</li>
          </ul>
        </div>
        <div className="checklist__col checklist__col--bad">
          <div className="checklist__examples">{GROUP}{ACTION}{TINY}</div>
          <ul>
            <li>Team or group photos</li>
            <li>Action shots, or photos with helmets on</li>
            <li>Screenshots or tiny images saved from social media</li>
          </ul>
        </div>
      </div>
      <p className="checklist__formats">
        <b>File types:</b> JPG, PNG, HEIC (iPhone), WebP, GIF, TIFF and BMP. Anything else is skipped, and we'll tell you which files.
      </p>
    </section>
  );
}
