export const HEADSHOT_STEPS = ["Add photos", "Check crops", "Download for ACHA"] as const;

/** ① Add photos → ② Check crops → ③ Download for ACHA. Finished steps can be clicked to go back. */
export function Stepper({ current, onSelect, canSelect, steps = HEADSHOT_STEPS }: {
  current: number;
  steps?: readonly string[];
  onSelect?: (step: number) => void;
  canSelect?: (step: number) => boolean;
}) {
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        const clickable = !!onSelect && i !== current && (canSelect?.(i) ?? i < current);
        const content = (
          <>
            <span className="stepper__num" aria-hidden="true">{state === "done" ? "✓" : i + 1}</span>
            <span className="stepper__label">{label}</span>
          </>
        );
        return (
          <li key={label} className={`stepper__step is-${state}`} aria-current={state === "current" ? "step" : undefined}>
            {clickable ? (
              <button type="button" className="stepper__btn" onClick={() => onSelect?.(i)}>{content}</button>
            ) : (
              <span className="stepper__btn">{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

