import type { ReactNode } from 'react';

export function Panel({ index, title, icon, children, className = '' }: {
  index: string;
  title: string;
  icon: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel__header">
        <span className="panel__index">{index}</span>
        <span className="panel__icon" aria-hidden>{icon}</span>
        <h2>{title}</h2>
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function SliderRow({ label, value, min, max, step, onChange, format }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="slider-row">
      <span className="slider-row__label">
        <span>{label}</span>
        <output>{format ? format(value) : value}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function ToggleRow({ label, checked, onChange, hint }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i className="toggle-ui" aria-hidden />
    </label>
  );
}
