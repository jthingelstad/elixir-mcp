import { useId, type ReactNode } from "react";

/**
 * An on/off switch: a real button with role="switch" that says whether it
 * is on. With `children` it is a whole row, the words beside the switch and
 * the row itself the tap target; without, `label` names it for a screen
 * reader.
 */
export function Switch({
  on,
  onChange,
  label,
  children,
  hint,
  disabled = false,
  id,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label?: string;
  children?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const own = useId();
  const words = `${id ?? own}-words`;
  const button = (
    <button
      id={id}
      type="button"
      className="switch"
      role="switch"
      aria-checked={on ? "true" : "false"}
      aria-label={children ? undefined : label}
      aria-labelledby={children ? words : undefined}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
  if (!children) return button;
  return (
    <div className="kit-switch" data-on={on ? "true" : undefined}>
      <span className="kit-switch__words">
        <span id={words} className="kit-switch__label">
          {children}
        </span>
        {hint ? <span className="kit-switch__hint">{hint}</span> : null}
      </span>
      {button}
    </div>
  );
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/**
 * A number with − and + either side, each a 44px target, and the number
 * itself typed in where a step at a time is too slow. `unit` follows the
 * number in words ("days"); the label names all three for a screen reader.
 */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit,
  disabled = false,
  id,
  describedBy,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: ReactNode;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
}) {
  const own = useId();
  const input = id ?? `${own}-n`;
  const n = Number.isFinite(Number(value)) ? Number(value) : min;
  // A step lands on the next multiple of `step` (45 goes to 50 or 40); a
  // typed number is kept as typed, whole and inside the range.
  const up = () =>
    onChange(clamp(Math.floor(n / step) * step + step, min, max));
  const down = () =>
    onChange(clamp(Math.ceil(n / step) * step - step, min, max));
  const typed = (v: number) => onChange(clamp(Math.round(v), min, max));
  return (
    <div className="kit-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="kit-stepper__step"
        aria-label={`Less ${label.toLowerCase()}`}
        disabled={disabled || n <= min}
        onClick={down}
      >
        <span aria-hidden="true">−</span>
      </button>
      <input
        id={input}
        className="kit-stepper__n"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(Number(value)) ? value : ""}
        aria-label={label}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return;
          const v = Number(raw);
          if (Number.isFinite(v)) typed(v);
        }}
      />
      {unit ? <span className="kit-stepper__unit">{unit}</span> : null}
      <button
        type="button"
        className="kit-stepper__step"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={disabled || n >= max}
        onClick={up}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

/**
 * A bar split into parts that add up to the whole, each part named with its
 * share in the legend under it. Parts at zero are left out of the bar and
 * kept in the legend. The bar is drawn as SVG, so no part needs a style.
 */
export function SplitBar({
  label,
  parts,
}: {
  label: string;
  parts: Array<{ key: string; label: string; share: number }>;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.share), 0) || 1;
  const shown = parts
    .map((p, i) => ({ ...p, i, w: (Math.max(0, p.share) * 100) / total }))
    .filter((p) => p.w > 0)
    .reduce<Array<{ key: string; i: number; x: number; w: number }>>(
      (out, p) => {
        const last = out[out.length - 1];
        out.push({ key: p.key, i: p.i, x: last ? last.x + last.w : 0, w: p.w });
        return out;
      },
      [],
    );
  return (
    <div
      className="kit-split"
      role="img"
      aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.share}%`).join(", ")}`}
    >
      <svg
        className="kit-split__bar"
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {shown.map((p) => (
          <rect
            key={p.key}
            className="kit-split__part"
            data-part={p.i % 4}
            x={p.x}
            width={p.w}
            height="10"
          />
        ))}
      </svg>
      <ul className="kit-split__legend" aria-hidden="true">
        {parts.map((p, i) => (
          <li key={p.key} data-part={i % 4}>
            {p.label} <b>{p.share}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
