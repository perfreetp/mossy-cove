import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import * as boothStore from './services/store'

createApp(App).mount('#app')

// Lightweight debugging / acceptance bridge for local end-to-end checks.
;(window as unknown as { __boothStore?: typeof boothStore }).__boothStore = boothStore
