import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import { NumberSlider } from './components/NumberSlider';
import { SceneManager } from './editor/SceneManager';
import { createEditorStore } from './editor/store';
import {
  breakPointMirror,
  createDefaultDocument,
  duplicateLashAsRow,
  duplicateRow,
  fillPerformanceLashes,
  normalizeDocument,
  setSegmentMirror,
  syncBrowMirror,
} from './editor/model';
import { otherSide } from './editor/faceGeometry';
import {
  DENSITY_LABELS,
  type Density,
  type EditorMode,
  type SelectionState,
  type Side,
  type Tool,
} from './editor/types';

export default function App() {
  let viewportRef: HTMLDivElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let scene: SceneManager | undefined;

  const editor = createEditorStore();
  const [mode, setMode] = createSignal<EditorMode>('brow');
  const [tool, setTool] = createSignal<Tool>('draw');
  const [zoomed, setZoomed] = createSignal(false);
  const [unilateral, setUnilateral] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [selection, setSelection] = createStore<SelectionState>({
    side: 'right',
    browPointId: null,
    lashId: null,
    rowId: null,
  });

  const selectedBrow = createMemo(() => editor.doc.brows[selection.side]);
  const selectedPoint = createMemo(
    () => selectedBrow().points.find((point) => point.id === selection.browPointId) ?? null,
  );
  const selectedLash = createMemo(
    () => editor.doc.lashes.find((lash) => lash.id === selection.lashId) ?? null,
  );
  const selectedRow = createMemo(() => {
    if (selection.rowId) {
      const explicit = editor.doc.rows.find((row) => row.id === selection.rowId);
      if (explicit) return explicit;
    }
    const lashRowId = selectedLash()?.rowId;
    return lashRowId ? editor.doc.rows.find((row) => row.id === lashRowId) ?? null : null;
  });

  function applySelection(patch: Partial<SelectionState>): void {
    const next: SelectionState = { ...selection, ...patch };
    setSelection(next);
    scene?.setSelection(next);
    if (zoomed() && patch.side && patch.side !== selection.side) {
      scene?.setEyeZoom(true, patch.side);
    }
  }

  function changeMode(next: EditorMode): void {
    setMode(next);
    scene?.setMode(next);
  }

  function changeTool(next: Tool): void {
    setTool(next);
    scene?.setTool(next);
  }

  function toggleUnilateral(value: boolean): void {
    setUnilateral(value);
    scene?.setUnilateralFineTune(value);
  }

  function restoreSelectionFromDocument(): void {
    const restored: SelectionState = { ...selection };
    const doc = editor.doc;
    if (
      restored.browPointId &&
      !(['left', 'right'] as Side[]).some((side) =>
        doc.brows[side].points.some((point) => point.id === restored.browPointId),
      )
    ) {
      restored.browPointId = null;
    }
    if (restored.lashId && !doc.lashes.some((lash) => lash.id === restored.lashId)) {
      restored.lashId = null;
      restored.rowId = null;
    }
    if (restored.rowId && !doc.rows.some((row) => row.id === restored.rowId)) {
      restored.rowId = selectedLash()?.rowId ?? null;
    }
    setSelection(restored);
    scene?.setSelection(restored);
  }

  function undo(): void {
    const restored = editor.undo();
    if (!restored) return;
    restoreSelectionFromDocument();
    scene?.refresh('all');
  }

  function redo(): void {
    const restored = editor.redo();
    if (!restored) return;
    restoreSelectionFromDocument();
    scene?.refresh('all');
  }

  function onKeyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if (
      ((event.ctrlKey || event.metaKey) && key === 'y') ||
      ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'z')
    ) {
      event.preventDefault();
      redo();
    } else if (!event.ctrlKey && !event.metaKey && key === 'e') {
      changeTool('erase');
    } else if (!event.ctrlKey && !event.metaKey && key === 'd') {
      changeTool('draw');
    } else if (!event.ctrlKey && !event.metaKey && key === 'v') {
      changeTool('adjust');
    }
  }

  onMount(() => {
    if (!viewportRef) return;
    scene = new SceneManager(viewportRef, {
      getDoc: () => editor.doc,
      beginHistory: editor.beginHistory,
      endHistory: editor.endHistory,
      transact: editor.transact,
      commit: editor.commit,
      onSelection: applySelection,
    });
    scene.setMode(mode());
    scene.setTool(tool());
    if (import.meta.env.DEV) {
      (window as unknown as { __browStudio?: unknown }).__browStudio = {
        scene,
        editor,
        applySelection,
      };
    }
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', onKeyDown);
      scene?.dispose();
      scene = undefined;
    });
  });

  function flashMessage(text: string): void {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 2600);
  }

  function exportProject(): void {
    const payload = JSON.stringify(editor.doc, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `brow-lash-curves-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    flashMessage('已导出眉形曲线与全部睫毛参数');
  }

  async function importProject(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const doc = normalizeDocument(parsed);
      editor.replaceDocument(doc);
      const next: SelectionState = {
        side: 'right',
        browPointId: null,
        lashId: null,
        rowId: null,
      };
      setSelection(next);
      scene?.setSelection(next);
      scene?.refresh('all');
      flashMessage(`已重新载入：${doc.brows.left.points.length + doc.brows.right.points.length} 个眉部控制点，${doc.lashes.length} 根睫毛`);
    } catch (error) {
      console.error(error);
      flashMessage('导入失败：请选择本工具导出的 JSON 文件');
    }
  }

  function toggleMirror(): void {
    editor.commit((doc) => {
      doc.mirror = !doc.mirror;
      if (doc.mirror) {
        const source: Side =
          doc.brows[selection.side].points.length >= 2
            ? selection.side
            : otherSide(selection.side);
        syncBrowMirror(doc, source);
      }
    });
    scene?.refresh('brows');
  }

  function changeDensity(density: Density): void {
    editor.commit((doc) => {
      doc.brows[selection.side].density = density;
      if (doc.mirror) syncBrowMirror(doc, selection.side);
    });
    scene?.refresh('brows');
  }

  function updatePointWidth(value: number): void {
    const { side, browPointId } = selection;
    if (!browPointId) return;
    editor.transact((doc) => {
      if (unilateral()) breakPointMirror(doc, side, browPointId);
      const point = doc.brows[side].points.find((item) => item.id === browPointId);
      if (!point) return;
      point.width = value;
      syncBrowMirror(doc, side);
    });
    scene?.refreshBrowLive(side);
  }

  function updateEndpointTaper(endpoint: 0 | -1, value: number): void {
    const side = selection.side;
    editor.transact((doc) => {
      const brow = doc.brows[side];
      const point = endpoint === 0 ? brow.points[0] : brow.points[brow.points.length - 1];
      if (!point) return;
      if (unilateral()) {
        const endpointId = point.id;
        breakPointMirror(doc, side, endpointId);
      }
      point.taper = value;
      syncBrowMirror(doc, side);
    });
    scene?.refreshBrowLive(side);
  }

  function toggleSegment(segmentIndex: number): void {
    editor.commit((doc) => {
      const current = doc.brows[selection.side].segmentMirror[segmentIndex] !== false;
      setSegmentMirror(doc, selection.side, segmentIndex, !current);
    });
    scene?.refresh('brows');
  }

  function deleteSelectedBrow(): void {
    editor.commit((doc) => {
      doc.brows[selection.side].points = [];
      doc.brows[selection.side].segmentMirror = [];
      doc.mirror = false;
    });
    applySelection({ browPointId: null });
    scene?.refresh('brows');
  }

  function updateLashValue(key: 'length' | 'curl' | 'thickness', value: number): void {
    const id = selection.lashId;
    if (!id) return;
    editor.transact((doc) => {
      const lash = doc.lashes.find((item) => item.id === id);
      if (lash) lash[key] = value;
    });
    scene?.refreshLash(id);
  }

  function updateRowValue(key: 'rotation' | 'lift', value: number): void {
    const rowId = selectedRow()?.id ?? selection.rowId;
    if (!rowId) return;
    editor.transact((doc) => {
      const row = doc.rows.find((item) => item.id === rowId);
      if (row) row[key] = value;
    });
    scene?.refresh('lashes');
  }

  function createRowFromSelectedLash(): void {
    const lashId = selection.lashId;
    if (!lashId) return;
    let rowId: string | null = null;
    editor.commit((doc) => {
      rowId = duplicateLashAsRow(doc, lashId, 9);
    });
    if (rowId) {
      applySelection({ rowId });
      scene?.refresh('lashes');
      flashMessage('已沿眼睑成排复制，可在下方整体旋转');
    }
  }

  function duplicateSelectedRow(): void {
    const rowId = selectedRow()?.id;
    if (!rowId) return;
    let newRowId: string | null = null;
    editor.commit((doc) => {
      newRowId = duplicateRow(doc, rowId);
    });
    if (newRowId) {
      applySelection({ rowId: newRowId });
      scene?.refresh('lashes');
      flashMessage('已复制为新的一排，并略微上移');
    }
  }

  function deleteSelectedLash(): void {
    const id = selection.lashId;
    if (!id) return;
    editor.commit((doc) => {
      doc.lashes = doc.lashes.filter((lash) => lash.id !== id);
    });
    applySelection({ lashId: null, rowId: null });
    scene?.refresh('lashes');
  }

  function fillHundreds(): void {
    editor.commit((doc) => fillPerformanceLashes(doc, 240));
    applySelection({ lashId: null, rowId: null, browPointId: null });
    scene?.setSelection(selection);
    scene?.refresh('all');
    flashMessage(`已生成 ${editor.doc.lashes.length} 根合批睫毛，拖动滑杆仍保持流畅`);
  }

  function resetSample(): void {
    editor.replaceDocument(createDefaultDocument());
    const next: SelectionState = {
      side: 'right',
      browPointId: null,
      lashId: null,
      rowId: null,
    };
    setSelection(next);
    scene?.setSelection(next);
    scene?.refresh('all');
    setZoomed(false);
    scene?.resetCamera();
    flashMessage('已恢复初始示例面部');
  }

  function toggleZoom(): void {
    const next = !zoomed();
    setZoomed(next);
    scene?.setEyeZoom(next, selection.side);
  }

  const toolButtons = createMemo(() =>
    mode() === 'brow'
      ? [
          { id: 'draw' as Tool, label: '手绘主线', key: 'D' },
          { id: 'adjust' as Tool, label: '控制点', key: 'V' },
          { id: 'erase' as Tool, label: '橡皮擦', key: 'E' },
        ]
      : [
          { id: 'draw' as Tool, label: '摆放睫毛', key: 'D' },
          { id: 'adjust' as Tool, label: '选择调节', key: 'V' },
          { id: 'erase' as Tool, label: '橡皮擦', key: 'E' },
        ],
  );

  const instruction = createMemo(() => {
    if (tool() === 'erase') {
      return '橡皮擦：点击单根睫毛删除；点击眉体删除整侧眉。按住拖动连续擦除睫毛，整次手势可一次撤销。';
    }
    if (mode() === 'brow' && tool() === 'draw') {
      return '在一侧面部按住并描绘眉形主线，松开后自动生成宽度变化的眉体和眉丝。普通控制点拖动会镜像跟随；按住 Alt 拖动或勾选“单侧微调”可解除相邻弧段联动。';
    }
    if (mode() === 'brow') {
      return '拖动金色控制点改变眉形弧度，默认对称跟随；拖动蓝色八面体上下改粗细。按住 Alt 单拖一侧，或在右侧将指定弧段“断开”。';
    }
    if (tool() === 'draw') {
      return '沿眼睑边缘点击或拖动即可逐根摆放睫毛；直接拖动已有睫毛可改变位置。选中后在右侧调节长度、卷翘角度和粗细。';
    }
    return '点击一根睫毛进行调节；可将它成排复制，并对整排设置旋转角度或复制为新排。';
  });

  return (
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">眉睫</span>
          <div>
            <h1>曲线塑形工作室</h1>
            <p>SolidJS · TypeScript · Three.js</p>
          </div>
        </div>

        <nav class="mode-tabs" aria-label="编辑模式">
          <button
            class={mode() === 'brow' ? 'active' : ''}
            onClick={() => changeMode('brow')}
            type="button"
          >
            眉部曲线
          </button>
          <button
            class={mode() === 'lash' ? 'active' : ''}
            onClick={() => changeMode('lash')}
            type="button"
          >
            睫毛编排
          </button>
        </nav>

        <div class="top-actions">
          <button type="button" onClick={undo} disabled={editor.history.past.length === 0} title="Ctrl/Cmd+Z">
            ↶ 撤销
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={editor.history.future.length === 0}
            title="Ctrl/Cmd+Shift+Z 或 Ctrl+Y"
          >
            ↷ 重做
          </button>
          <button type="button" onClick={() => fileInputRef?.click()}>
            导入
          </button>
          <button type="button" class="primary" onClick={exportProject}>
            导出文件
          </button>
          <input
            ref={(el) => (fileInputRef = el)}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void importProject(file);
              event.currentTarget.value = '';
            }}
          />
        </div>
      </header>

      <main class="workspace">
        <aside class="tool-rail" aria-label="工具">
          <div class="rail-group">
            {toolButtons().map((item) => (
              <button
                type="button"
                class={`rail-button ${tool() === item.id ? 'active' : ''}`}
                onClick={() => changeTool(item.id)}
                title={`${item.label} (${item.key})`}
              >
                <span class="rail-icon">
                  {item.id === 'draw' ? '✎' : item.id === 'adjust' ? '◉' : '⌫'}
                </span>
                <span>{item.label}</span>
                <kbd>{item.key}</kbd>
              </button>
            ))}
          </div>

          <div class="rail-divider" />

          <label class="mirror-toggle">
            <input
              type="checkbox"
              checked={editor.doc.mirror}
              onChange={toggleMirror}
            />
            <span>左右镜像</span>
          </label>

          <label class="mirror-toggle unilateral" title="也可以在拖动控制点或粗细手柄时按住 Alt">
            <input
              type="checkbox"
              checked={unilateral()}
              onChange={(event) => toggleUnilateral(event.currentTarget.checked)}
            />
            <span>单侧微调</span>
          </label>

          <button type="button" class="rail-wide" onClick={toggleZoom}>
            {zoomed() ? '恢复全景' : '眼部局部精修'}
          </button>
          <button type="button" class="rail-wide subtle" onClick={() => scene?.resetCamera()}>
            重置视角
          </button>

          <div class="rail-stats">
            <strong>{editor.doc.lashes.length}</strong>
            <span>根睫毛</span>
            <small>单合批 Draw Call</small>
          </div>
        </aside>

        <section class="viewport-column">
          <div class="viewport" ref={viewportRef} aria-label="三维面部编辑视图" />
          <div class="instruction-bar">{instruction()}</div>
          {message() ? <div class="toast" role="status">{message()}</div> : null}
        </section>

        <aside class="inspector">
          <section class="panel">
            <div class="panel-title-row">
              <h2>{mode() === 'brow' ? '眉形参数' : '睫毛参数'}</h2>
              <div class="side-switch">
                <button
                  type="button"
                  class={selection.side === 'left' ? 'active' : ''}
                  onClick={() => applySelection({ side: 'left' })}
                >
                  左 / 画面左
                </button>
                <button
                  type="button"
                  class={selection.side === 'right' ? 'active' : ''}
                  onClick={() => applySelection({ side: 'right' })}
                >
                  右 / 画面右
                </button>
              </div>
            </div>
            <p class="help-text">{instruction()}</p>
          </section>

          {mode() === 'brow' ? (
            <>
              <section class="panel">
                <h3>浓密档位</h3>
                <div class="segmented three">
                  {(['sparse', 'natural', 'dense'] as Density[]).map((density) => (
                    <button
                      type="button"
                      class={selectedBrow().density === density ? 'active' : ''}
                      onClick={() => changeDensity(density)}
                    >
                      {DENSITY_LABELS[density]}
                    </button>
                  ))}
                </div>
                <p class="field-hint">
                  切档后沿当前主线按确定性分布重算 {
                    { sparse: 72, natural: 148, dense: 286 }[selectedBrow().density]
                  } 根眉丝；撤销会还原档位与曲线。
                </p>

                <div class="endpoint-tapers">
                  <NumberSlider
                    label="起端收尖"
                    min={0}
                    max={1}
                    step={0.01}
                    value={selectedBrow().points[0]?.taper ?? 0}
                    onBegin={editor.beginHistory}
                    onEnd={editor.endHistory}
                    onValue={(value) => updateEndpointTaper(0, value)}
                  />
                  <NumberSlider
                    label="末端收尖"
                    min={0}
                    max={1}
                    step={0.01}
                    value={selectedBrow().points[selectedBrow().points.length - 1]?.taper ?? 1}
                    onBegin={editor.beginHistory}
                    onEnd={editor.endHistory}
                    onValue={(value) => updateEndpointTaper(-1, value)}
                  />
                </div>
              </section>

              <section class="panel">
                <h3>控制点弧度 / 粗细</h3>
                {selectedPoint() ? (
                  <>
                    <p class="selected-line">已选中控制点 {selection.browPointId?.slice(-4)}</p>
                    <NumberSlider
                      label="该点眉宽"
                      min={0.018}
                      max={0.18}
                      step={0.002}
                      value={selectedPoint()!.width}
                      onBegin={editor.beginHistory}
                      onEnd={editor.endHistory}
                      onValue={updatePointWidth}
                      hint="也可上下拖动蓝色八面体手柄。调整后相邻弧段解除镜像。"
                    />
                  </>
                ) : (
                  <p class="empty-note">在三维眉线上点击金色控制点，可精确调节该点粗细。</p>
                )}

                <div class="segment-links">
                  <h4>弧段镜像联动</h4>
                  {selectedBrow().segmentMirror.length === 0 ? (
                    <p class="empty-note">该侧还没有眉形，请使用“手绘主线”创建。</p>
                  ) : (
                    selectedBrow().segmentMirror.map((linked, index) => (
                      <div class={`segment-row ${linked === false ? 'unlinked' : ''}`}>
                        <span>第 {index + 1} 段</span>
                        <span class="badge">{linked === false ? '已独立' : '联动中'}</span>
                        <button type="button" onClick={() => toggleSegment(index)}>
                          {linked === false ? '恢复联动' : '断开'}
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button type="button" class="danger-button" onClick={deleteSelectedBrow}>
                  删除整侧眉体
                </button>
              </section>
            </>
          ) : (
            <>
              <section class="panel">
                <h3>单根睫毛三项调节</h3>
                {selectedLash() ? (
                  <>
                    <p class="selected-line">
                      {selection.side === 'left' ? '左侧' : '右侧'}睫毛 · 眼睑位置 t=
                      {selectedLash()!.t.toFixed(2)}
                    </p>
                    <NumberSlider
                      label="长度"
                      min={4}
                      max={16}
                      step={0.1}
                      unit=""
                      value={selectedLash()!.length}
                      onBegin={editor.beginHistory}
                      onEnd={editor.endHistory}
                      onValue={(value) => updateLashValue('length', value)}
                    />
                    <NumberSlider
                      label="卷翘角度"
                      min={0}
                      max={90}
                      step={1}
                      unit="°"
                      value={selectedLash()!.curl}
                      onBegin={editor.beginHistory}
                      onEnd={editor.endHistory}
                      onValue={(value) => updateLashValue('curl', value)}
                      hint="角度增大时，睫毛末端沿卷翘曲线向上跟随。"
                    />
                    <NumberSlider
                      label="粗细"
                      min={1}
                      max={8}
                      step={0.1}
                      value={selectedLash()!.thickness}
                      onBegin={editor.beginHistory}
                      onEnd={editor.endHistory}
                      onValue={(value) => updateLashValue('thickness', value)}
                    />
                    <div class="button-row">
                      <button type="button" class="primary" onClick={createRowFromSelectedLash}>
                        成排复制 9 根
                      </button>
                      <button type="button" class="danger" onClick={deleteSelectedLash}>
                        删除此根
                      </button>
                    </div>
                  </>
                ) : (
                  <p class="empty-note">点击视图中的一根睫毛，或使用“摆放睫毛”沿眼睑新建。</p>
                )}
              </section>

              <section class="panel">
                <h3>整排旋转 / 复制</h3>
                {selectedRow() ? (
                  <>
                    <p class="selected-line">{selectedRow()!.name}</p>
                    <NumberSlider
                      label="整排旋转角"
                      min={-70}
                      max={70}
                      step={1}
                      unit="°"
                      value={selectedRow()!.rotation}
                      onBegin={editor.beginHistory}
                      onEnd={editor.endHistory}
                      onValue={(value) => updateRowValue('rotation', value)}
                      hint="围绕眼睑锚点统一改变整排倾斜方向。"
                    />
                    <NumberSlider
                      label="排层偏移"
                      min={0}
                      max={0.12}
                      step={0.005}
                      value={selectedRow()!.lift}
                      onBegin={editor.beginHistory}
                      onEnd={editor.endHistory}
                      onValue={(value) => updateRowValue('lift', value)}
                    />
                    <button type="button" class="primary wide" onClick={duplicateSelectedRow}>
                      复制为新的一排
                    </button>
                  </>
                ) : (
                  <p class="empty-note">
                    将一根睫毛“成排复制”后，可在此整体旋转；也可以复制已有排形成多层睫毛。
                  </p>
                )}
              </section>
            </>
          )}

          <section class="panel performance-panel">
            <h3>性能与文件</h3>
            <p>
              当前 <strong>{editor.doc.lashes.length}</strong> 根睫毛使用固定分段管状几何体合并为
              1 个 BufferGeometry；单根调参只更新对应顶点区间。
            </p>
            <button type="button" class="wide" onClick={fillHundreds}>
              生成 480 根压力示例
            </button>
            <button type="button" class="wide subtle" onClick={resetSample}>
              恢复初始示例
            </button>
            <p class="field-hint">
              导出的 JSON 包含眉部主线控制点、段镜像状态、密度、收尖值，以及每根睫毛的长度/卷翘/粗细和排组参数。
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}
