import { store } from '../store/network'
import { STORAGE_KEY } from '../constants'
import type { NetworkData } from '../types'

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function IoPanel() {
  const doExport = () => {
    const data = store.exportData()
    download(`roadnet-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, JSON.stringify(data, null, 2))
  }

  const doSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.exportData()))
  }

  const doLoad = () => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return alert('本地没有已保存的路网')
    try {
      store.importData(JSON.parse(raw) as NetworkData)
    } catch {
      alert('本地数据损坏,无法读取')
    }
  }

  const doImport = async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text) as NetworkData
      if (data.version !== 1 || !Array.isArray(data.intersections) || !Array.isArray(data.edges)) {
        alert('文件格式不正确:缺少 version 1 路网结构')
        return
      }
      store.importData(data)
    } catch (err) {
      alert('导入失败:' + (err as Error).message)
    }
  }

  const onPick = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) void doImport(file)
    input.value = ''
  }

  return (
    <section class="panel io-panel">
      <header class="panel-head">
        <h2>数据管理</h2>
      </header>
      <div class="panel-body io-grid">
        <button class="btn primary" onClick={doExport}>
          ⭳ 导出路网文件
        </button>
        <label class="btn primary file-btn">
          ⭱ 导入路网文件
          <input type="file" accept="application/json,.json" onChange={onPick} hidden />
        </label>
        <button class="btn ghost" onClick={doSave}>
          保存到浏览器本地
        </button>
        <button class="btn ghost" onClick={doLoad}>
          读取本地保存
        </button>
        <button class="btn danger" onClick={() => confirm('确定清空整个路网?此操作可撤销。') && store.clear()}>
          清空路网
        </button>
      </div>
    </section>
  )
}
