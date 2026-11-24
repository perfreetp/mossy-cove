import type { JSX } from 'solid-js';

interface NumberSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: string;
  onBegin: () => void;
  onEnd: () => void;
  onValue: (value: number) => void;
}

export function NumberSlider(props: NumberSliderProps) {
  const handleInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (event) => {
    props.onValue(event.currentTarget.valueAsNumber);
  };

  const handleKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (event) => {
    if (event.repeat) return;
    if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End' || event.key === 'PageUp' || event.key === 'PageDown') {
      props.onBegin();
    }
  };

  return (
    <label class="slider-row">
      <span class="slider-label">
        <span>{props.label}</span>
        <output>
          {Number.isFinite(props.value) ? props.value.toFixed(props.step && props.step < 1 ? 2 : 0) : props.value}
          {props.unit ?? ''}
        </output>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onPointerDown={props.onBegin}
        onPointerUp={props.onEnd}
        onPointerCancel={props.onEnd}
        onKeyDown={handleKeyDown}
        onKeyUp={props.onEnd}
        onInput={handleInput}
      />
      {props.hint ? <small class="field-hint">{props.hint}</small> : null}
    </label>
  );
}
