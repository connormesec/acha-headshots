import { Link } from "react-router";
import { useAuth } from "./AuthContext";

const TOOLS = [
  {
    to: "/headshots",
    title: "Roster headshots",
    text: "Crop and shrink headshots to ACHA's 1000 × 1500 size, ready to upload.",
  },
  {
    to: "/jobs",
    title: "Sort game photos",
    text: "Drop in a game's photos and get one folder per player, matched by jersey number.",
  },
  {
    to: "/player-bg",
    title: "Player page backgrounds",
    text: "Pick each player's best action shot and crop it to a wide 1080 × 440 header.",
  },
  {
    to: "/teams",
    title: "Teams & rosters",
    text: "Import a roster from ACHA or your team website, or type it in. Sorting matches against it.",
  },
] as const;

export function Home() {
  const { me } = useAuth();
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">ACHA Photo Tools</p>
          <h1>What do you want to do?</h1>
        </div>
      </div>
      <div className="tool-grid">
        {TOOLS.map((t) => (
          <Link key={t.to} to={t.to} className="tool-card">
            <h2>{t.title}</h2>
            <p>{t.text}</p>
            <span className="tool-card__go" aria-hidden="true">Open →</span>
          </Link>
        ))}
      </div>
      <p className="hs-privacy">
        🔒 <b>Your photos stay on your device.</b> Everything runs in your browser.
        {me?.admin
          ? " As an admin you can also turn on AI help for jersey numbers the local reader can't make out. Small crops of just those players are then sent to OpenAI."
          : " Admins can also turn on AI help for jersey numbers the local reader can't make out."}
      </p>
    </>
  );
}
