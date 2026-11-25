/** 各 Shadow DOM 组件共享的设计令牌与控件样式 */
export const sharedCss = `
:host {
  --bg-control: #202e3d;
  --bg-control-hover: #28394c;
  --line: #28384a;
  --line-strong: #35495e;
  --text: #e7eef6;
  --text-dim: #9db0c3;
  --text-faint: #6c8197;
  --accent: #5fd08a;
  --accent-strong: #34b36a;
  --accent-soft: rgba(95,208,138,.14);
  --tree: #3fae6a;
  --bush: #9ccc5c;
  --info: #5ab0ef;
  --warn: #e2a455;
  --danger: #e06a5b;
  font-family: "Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;
  color: var(--text);
}
* { box-sizing: border-box; }
button { font-family: inherit; }

.panel-inner { padding: 16px 16px 22px; display: flex; flex-direction: column; gap: 18px; }

.section-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; font-weight: 700; letter-spacing: 2px;
  color: var(--text-dim); margin: 0 0 10px;
  text-transform: uppercase;
}
.section-title .sub { letter-spacing: 0; font-weight: 500; color: var(--text-faint); font-size: 11px; }

.hint-box {
  border: 1px solid var(--line);
  background: rgba(90,176,239,.07);
  border-radius: 10px;
  padding: 9px 11px;
  font-size: 11.5px; line-height: 1.6; color: var(--text-dim);
}
.hint-box b { color: var(--info); font-weight: 600; }

/* ---------- 按钮 ---------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 32px; padding: 0 13px;
  border-radius: 8px; border: 1px solid var(--line-strong);
  background: var(--bg-control); color: var(--text);
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: background .15s, border-color .15s, transform .05s, opacity .15s;
  white-space: nowrap; user-select: none;
}
.btn:hover { background: var(--bg-control-hover); border-color: #435a73; }
.btn:active { transform: translateY(1px); }
.btn:disabled { opacity: .38; cursor: not-allowed; }
.btn.primary {
  background: linear-gradient(180deg, #4cc981, #2faa63);
  border-color: #2c9c5c; color: #08150d;
  box-shadow: 0 4px 14px rgba(52,179,106,.28);
}
.btn.primary:hover { filter: brightness(1.07); background: linear-gradient(180deg,#56d48a,#33b368); }
.btn.block { width: 100%; }
.btn.sm { height: 26px; padding: 0 9px; font-size: 11.5px; border-radius: 7px; }
.btn.icon { width: 32px; padding: 0; }
.btn.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.btn.danger-ghost:hover { border-color: var(--danger); color: var(--danger); background: rgba(224,106,91,.1); }

/* ---------- 分段选择器 ---------- */
.seg {
  display: grid; grid-auto-flow: column; gap: 4px;
  padding: 4px; border-radius: 10px;
  background: #101923; border: 1px solid var(--line);
}
.seg button {
  height: 30px; border: 0; border-radius: 7px;
  background: transparent; color: var(--text-dim);
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: all .15s;
}
.seg button:hover { color: var(--text); }
.seg button[aria-pressed="true"] {
  background: linear-gradient(180deg, #2c4055, #243648);
  color: #fff;
  box-shadow: inset 0 0 0 1px #3c556e, 0 2px 8px rgba(0,0,0,.25);
}
.seg button[data-tone="tree"][aria-pressed="true"] { color: #b9f0cf; }

/* ---------- 滑块行 ---------- */
.slider-row { margin-bottom: 14px; }
.slider-row:last-child { margin-bottom: 0; }
.slider-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 7px; font-size: 12.5px;
}
.slider-head label { color: var(--text-dim); font-weight: 600; }
.slider-head output {
  color: var(--accent); font-weight: 700; font-variant-numeric: tabular-nums;
  background: var(--accent-soft); padding: 1px 8px; border-radius: 6px;
  font-size: 12px; min-width: 44px; text-align: center;
}

input[type="range"].slider {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 22px; background: transparent; cursor: pointer; margin: 0;
}
input[type="range"].slider::-webkit-slider-runnable-track {
  height: 5px; border-radius: 4px;
  background: linear-gradient(90deg, var(--accent) var(--fill,50%), #2a3a4c var(--fill,50%));
}
input[type="range"].slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: #f2fbf6; border: 3px solid var(--accent-strong);
  margin-top: -5.5px;
  box-shadow: 0 2px 8px rgba(0,0,0,.45);
  transition: transform .12s;
}
input[type="range"].slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
input[type="range"].slider::-moz-range-track {
  height: 5px; border-radius: 4px; background: #2a3a4c;
}
input[type="range"].slider::-moz-range-progress { height: 5px; border-radius: 4px; background: var(--accent); }
input[type="range"].slider::-moz-range-thumb {
  width: 11px; height: 11px; border-radius: 50%;
  background: #f2fbf6; border: 3px solid var(--accent-strong);
  box-shadow: 0 2px 8px rgba(0,0,0,.45);
}

.ratio-bar {
  display: flex; height: 8px; border-radius: 6px; overflow: hidden;
  border: 1px solid var(--line); margin-top: 8px;
}
.ratio-bar .tree { background: linear-gradient(90deg,#2f9e62,#55c987); }
.ratio-bar .bush { background: linear-gradient(90deg,#86b84a,#b7e074); }
.ratio-labels { display:flex; justify-content:space-between; font-size:11px; color: var(--text-faint); margin-top:5px; }

/* ---------- 区域列表 ---------- */
.zone-list { display: flex; flex-direction: column; gap: 7px; }
.zone-item {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border-radius: 9px;
  background: var(--bg-panel-2); border: 1px solid var(--line);
}
.zone-dot { width: 9px; height: 9px; border-radius: 3px; flex: 0 0 auto; }
.zone-name { flex: 1 1 auto; font-size: 12.5px; font-weight: 600; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zone-size { font-size: 10.5px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.zone-item .mini-actions { display: flex; gap: 4px; }
.mini-btn {
  width: 24px; height: 24px; display: grid; place-items: center;
  border-radius: 6px; border: 1px solid transparent;
  background: transparent; color: var(--text-faint); cursor: pointer;
  font-size: 13px; transition: all .13s;
}
.mini-btn:hover { background: var(--bg-control); color: var(--text); border-color: var(--line-strong); }
.mini-btn.del:hover { color: var(--danger); border-color: rgba(224,106,91,.5); background: rgba(224,106,91,.1); }
.empty-tip { font-size: 12px; color: var(--text-faint); text-align: center; padding: 14px 8px;
  border: 1px dashed var(--line-strong); border-radius: 10px; }

/* ---------- 图层卡片 ---------- */
.layer-card {
  border: 1px solid var(--line); border-radius: 12px;
  background: linear-gradient(180deg, var(--bg-panel-2), #18222d);
  padding: 13px; display: flex; flex-direction: column; gap: 11px;
  transition: border-color .15s, opacity .2s;
}
.layer-card.is-hidden { opacity: .62; }
.layer-head { display: flex; align-items: center; gap: 11px; }
.layer-icon {
  width: 38px; height: 38px; border-radius: 10px; flex: 0 0 auto;
  display: grid; place-items: center;
}
.layer-icon.tree { background: rgba(63,174,106,.16); color: #6fd49a; }
.layer-icon.bush { background: rgba(156,204,92,.15); color: #c0e585; }
.layer-title { flex: 1 1 auto; min-width: 0; }
.layer-title strong { display: block; font-size: 13.5px; }
.layer-title span { font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums; }

.switch { position: relative; width: 38px; height: 21px; flex: 0 0 auto; cursor: pointer; }
.switch input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; z-index: 2; }
.switch .track {
  position: absolute; inset: 0; border-radius: 20px;
  background: #33465c; transition: background .18s;
}
.switch .thumb {
  position: absolute; top: 2.5px; left: 3px; width: 16px; height: 16px;
  border-radius: 50%; background: #dbe6f1; transition: transform .18s, background .18s;
  box-shadow: 0 1px 4px rgba(0,0,0,.4);
}
.switch input:checked + .track { background: var(--accent-strong); }
.switch input:checked + .track .thumb { transform: translateX(16px); background: #f4fff8; }

.layer-foot { display: flex; gap: 8px; }
.layer-foot .btn { flex: 1; }

.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stat-box {
  background: var(--bg-panel-2); border: 1px solid var(--line);
  border-radius: 10px; padding: 9px 11px;
}
.stat-box .k { font-size: 10.5px; color: var(--text-faint); letter-spacing: 1px; }
.stat-box .v { font-size: 19px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.25; }
.stat-box .v.tree { color: #6fd49a; }
.stat-box .v.bush { color: #c0e585; }
.stat-box .v.accent { color: var(--accent); }
.stat-box .v.info { color: var(--info); }

.history-mini { font-size: 11.5px; color: var(--text-faint); display:flex; justify-content:space-between; gap:8px; }
.history-mini b { color: var(--text-dim); font-weight: 600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* ---------- 工具栏 ---------- */
.toolbar-root { display: flex; align-items: center; gap: 14px; width: 100%; min-width: 0; }
.tool-group { display: flex; align-items: center; gap: 6px; }
.tool-divider { width: 1px; height: 26px; background: var(--line-strong); flex: 0 0 auto; }
.tool-btn {
  display: inline-flex; align-items: center; gap: 7px;
  height: 36px; padding: 0 13px; border-radius: 9px;
  border: 1px solid transparent; background: transparent;
  color: var(--text-dim); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
.tool-btn:hover { background: var(--bg-control); color: var(--text); }
.tool-btn[aria-pressed="true"] {
  background: var(--accent-soft); color: var(--accent);
  border-color: rgba(95,208,138,.55);
}
.tool-btn svg { width: 17px; height: 17px; }
.brush-seg { display: flex; gap: 3px; padding: 3px; background: #101923; border: 1px solid var(--line); border-radius: 9px; }
.brush-seg button {
  height: 28px; min-width: 42px; padding: 0 8px; border: 0; border-radius: 6px;
  background: transparent; color: var(--text-faint); font-size: 12px; font-weight: 700; cursor: pointer;
}
.brush-seg button[aria-pressed="true"] { background: #2c4055; color: #ffd2b8; }
.brush-size-dot { display:inline-block; border-radius:50%; background: currentColor; vertical-align: middle; margin-right:5px; }
.toolbar-spacer { flex: 1 1 auto; }
.kbd {
  font-size: 10px; color: var(--text-faint); border: 1px solid var(--line-strong);
  border-bottom-width: 2px; border-radius: 5px; padding: 0 5px; line-height: 16px;
}

/* ---------- 高度带控制条 ---------- */
.band-shell {
  background: linear-gradient(180deg, rgba(22,32,43,.96), rgba(17,25,34,.96));
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  box-shadow: var(--shadow-pop);
  backdrop-filter: blur(8px);
  padding: 12px 16px 10px;
}
.band-head { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
.band-title { font-size: 12.5px; font-weight: 800; letter-spacing: 1px; display:flex; align-items:center; gap:7px; }
.band-title .band-ico { color: var(--info); }
.band-values { margin-left: auto; display: flex; gap: 8px; align-items: center;
  font-variant-numeric: tabular-nums; font-size: 12px; }
.band-chip { background: #101923; border: 1px solid var(--line); border-radius: 7px; padding: 2px 9px; color: var(--text-dim); }
.band-chip b { color: #8fd0ff; }
.band-chip.out b { color: var(--warn); }

.band-track-wrap { position: relative; height: 46px; margin: 0 6px; }
.band-hist { position: absolute; inset: 6px 0 12px; width: 100%; height: 28px; opacity: .55; border-radius: 5px; }
.band-range-line {
  position: absolute; left: 0; right: 0; top: 18px; height: 6px;
  border-radius: 5px; background: #26374a;
}
.band-range-fill {
  position: absolute; top: 0; height: 100%;
  border-radius: 5px;
  background: linear-gradient(90deg, rgba(90,176,239,.55), rgba(95,208,138,.75), rgba(226,164,85,.7));
}
.band-track-wrap input[type="range"].dual {
  position: absolute; left: 0; top: 9px; width: 100%; height: 24px;
  -webkit-appearance: none; appearance: none; background: transparent; pointer-events: none; margin: 0;
}
.band-track-wrap input[type="range"].dual::-webkit-slider-runnable-track { background: transparent; height: 6px; }
.band-track-wrap input[type="range"].dual::-webkit-slider-thumb {
  -webkit-appearance: none; pointer-events: auto;
  width: 18px; height: 18px; border-radius: 50%;
  background: #f4faff; border: 4px solid var(--info);
  margin-top: -6px; box-shadow: 0 2px 10px rgba(0,0,0,.55); cursor: ew-resize;
}
.band-track-wrap input[type="range"].dual.high::-webkit-slider-thumb { border-color: var(--warn); }
.band-track-wrap input[type="range"].dual::-moz-range-thumb {
  pointer-events: auto; width: 11px; height: 11px; border-radius: 50%;
  background: #f4faff; border: 4px solid var(--info); cursor: ew-resize;
}
.band-track-wrap input[type="range"].dual.high::-moz-range-thumb { border-color: var(--warn); }
.band-scale { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-faint); margin: 0 6px; }

/* ---------- 视口内缩放控件 / 提示 ---------- */
.zoom-cluster {
  position: absolute; right: 14px; bottom: 18px;
  display: flex; flex-direction: column; gap: 6px; z-index: 5;
}
.zoom-btn {
  width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: rgba(20,29,40,.92); color: var(--text-dim);
  font-size: 18px; font-weight: 700; cursor: pointer;
  display: grid; place-items: center;
  transition: all .14s; backdrop-filter: blur(6px);
}
.zoom-btn:hover { color: #fff; border-color: #4a6480; background: #243446; }
.hint-chip {
  position: absolute; left: 14px; top: 14px; z-index: 5;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 13px; border-radius: 999px;
  background: rgba(16,25,35,.82); border: 1px solid var(--line);
  color: var(--text-dim); font-size: 12px; backdrop-filter: blur(6px);
  pointer-events: none;
}
.hint-chip .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 0 0 rgba(95,208,138,.6); animation: pulse 2s infinite; }
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(95,208,138,.55); }
  70% { box-shadow: 0 0 0 8px rgba(95,208,138,0); }
  100% { box-shadow: 0 0 0 0 rgba(95,208,138,0); }
}
`;

let sheet: CSSStyleSheet | null = null;
export function getSharedSheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(sharedCss);
  }
  return sheet;
}
