<script setup lang="ts">
import { history } from '../state/store'

const props = withDefaults(
  defineProps<{
    modelValue: number
    label: string
    min: number
    max: number
    step: number
    unit?: string
    display?: (value: number) => string
    historyLabel?: string
  }>(),
  { unit: '', historyLabel: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement
  emit('update:modelValue', Number(input.value))
}

function beginGesture(): void {
  history.begin()
}

function commitGesture(): void {
  history.commit(props.historyLabel ?? `调整${props.label}`)
}

function onKeydown(event: KeyboardEvent): void {
  if (
    event.key.startsWith('Arrow') ||
    event.key === 'Home' ||
    event.key === 'End' ||
    event.key === 'PageUp' ||
    event.key === 'PageDown'
  ) {
    history.begin()
  }
}

function formatted(value: number): string {
  if (props.display) return props.display(value)
  const text = props.step < 0.1 ? value.toFixed(2) : props.step < 1 ? value.toFixed(1) : Math.round(value).toString()
  return props.unit ? `${text} ${props.unit}` : text
}
</script>

<template>
  <label class="param-slider">
    <span class="param-slider__row">
      <span class="param-slider__label">{{ label }}</span>
      <output class="param-slider__value">{{ formatted(modelValue) }}</output>
    </span>
    <input
      class="range"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      @pointerdown="beginGesture"
      @focus="beginGesture"
      @keydown="onKeydown"
      @input="onInput"
      @change="commitGesture"
      @blur="commitGesture"
    />
  </label>
</template>
