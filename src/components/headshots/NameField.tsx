import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export function stemOf(outputName: string): string {
  return outputName.replace(/\.jpg$/i, "");
}

/** Move focus between the name fields of the cards on the page (Enter / Tab = next). */
function focusSibling(from: HTMLInputElement, step: 1 | -1): boolean {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-name-field='card']"));
  const next = all[all.indexOf(from) + step];
  if (!next) return false;
  next.focus();
  return true;
}

/** Output file name. The ".jpg" is fixed; the user only types the name. Saves on blur/Enter. */
export function NameField({ value, onSave, chain = false, id, disabled }: {
  value: string;
  onSave: (name: string) => Promise<void>;
  chain?: boolean; // part of the card grid: Enter/Tab jumps to the next card
  id?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(stemOf(value));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const focused = useRef(false);
  const saved = useRef(stemOf(value)); // last name that was saved

  useEffect(() => {
    saved.current = stemOf(value);
    if (!focused.current) setDraft(stemOf(value));
  }, [value]);

  const commit = async () => {
    const next = draft.trim();
    if (next === saved.current) {
      setError(undefined);
      return true;
    }
    if (!next) {
      setError("Type a name for this photo.");
      return false;
    }
    setSaving(true);
    try {
      await onSave(next);
      saved.current = next;
      setError(undefined);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation(); // cancel the edit, don't close the surrounding dialog
      setDraft(stemOf(value));
      setError(undefined);
      e.currentTarget.blur();
      return;
    }
    const forward = e.key === "Enter" || (e.key === "Tab" && !e.shiftKey);
    const back = e.key === "Tab" && e.shiftKey;
    if (!chain) {
      if (e.key === "Enter") {
        e.preventDefault();
        await commit();
      }
      return;
    }
    if (!forward && !back) return;
    const input = e.currentTarget;
    e.preventDefault();
    if (await commit()) {
      if (!focusSibling(input, forward ? 1 : -1)) input.blur();
    }
  };

  return (
    <div className="name-field">
      <div className={`name-field__box ${error ? "is-invalid" : ""}`}>
        <input
          id={id}
          data-name-field={chain ? "card" : undefined}
          value={draft}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          placeholder="firstname_lastname##"
          aria-label="File name"
          aria-invalid={!!error}
          onFocus={(e) => {
            focused.current = true;
            e.currentTarget.select();
          }}
          onBlur={() => {
            focused.current = false;
            void commit();
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className="name-field__ext" aria-hidden="true">{saving ? "…" : ".jpg"}</span>
      </div>
      {error && <span className="name-field__error" role="alert">{error}</span>}
    </div>
  );
}
