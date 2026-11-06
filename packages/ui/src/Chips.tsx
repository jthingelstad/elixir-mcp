import type { ButtonHTMLAttributes, ReactNode } from "react";

/** One toggle chip: a real button that says whether it is pressed. */
export function Chip({
  pressed,
  count,
  children,
  className,
  ...rest
}: {
  pressed: boolean;
  count?: ReactNode;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed">) {
  return (
    <button
      type="button"
      {...rest}
      className={className ? `kit-chip ${className}` : "kit-chip"}
      aria-pressed={pressed}
    >
      {children}
      {count != null ? <b>{count}</b> : null}
    </button>
  );
}

export interface ChipOption {
  key: string;
  label: ReactNode;
  count?: ReactNode;
}

/**
 * A row of chips, one pressed at a time, named for a screen reader. It
 * wraps rather than scrolls. For anything else (several pressed at once),
 * put `Chip`s inside a `.kit-chips` group yourself.
 */
export function Chips({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ChipOption[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      className={className ? `kit-chips ${className}` : "kit-chips"}
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <Chip
          key={o.key}
          pressed={o.key === value}
          count={o.count}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  );
}
