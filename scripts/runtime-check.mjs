import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const candidateChromePaths = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)
const chromePath = candidateChromePaths.find((candidate) => existsSync(candidate))
if (!chromePath) {
  console.error('Set CHROME_PATH to a Chrome/Chromium executable before running the smoke check.')
  process.exit(1)
}
const port = 9333
const profile = mkdtempSync(path.join(tmpdir(), 'cloud-sea-chrome-'))
const downloadDirectory = path.join(profile, 'downloads')
mkdirSync(downloadDirectory, { recursive: true })

const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--window-size=1440,1000',
  'http://127.0.0.1:4173/',
], { stdio: ['ignore', 'ignore', 'pipe'] })

let stderr = ''
chrome.stderr.on('data', (chunk) => { stderr += chunk.toString() })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson(urlPath) {
  const response = await fetch(`http://127.0.0.1:${port}${urlPath}`)
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`)
  return response.json()
}

async function waitForCdp(retries = 40) {
  for (let i = 0; i < retries; i += 1) {
    try {
      return await getJson('/json/version')
    } catch {
      await sleep(250)
    }
  }
  throw new Error('Chrome DevTools did not start')
}

const errors = []
const warnings = []

try {
  await waitForCdp()
  await sleep(500)
  const targets = await getJson('/json/list')
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
  if (!target) throw new Error('No page target found')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let nextId = 1
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      return
    }

    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      errors.push(details.exception?.description ?? details.text)
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')
      if (message.params.type === 'error') errors.push(text)
      if (message.params.type === 'warning') warnings.push(text)
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      errors.push(message.params.entry.text)
    }
  })

  function send(method, params = {}) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  await sleep(6500)

  const result = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      title: document.title,
      text: document.querySelector('#app')?.innerText?.slice(0, 1600) ?? '',
      canvasCount: document.querySelectorAll('canvas').length,
      canvasWidth: document.querySelector('.scene-canvas')?.width ?? 0,
      canvasHeight: document.querySelector('.scene-canvas')?.height ?? 0,
      hasWebglError: Boolean(document.querySelector('.webgl-error')),
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).slice(0, 30)
    })`,
    returnByValue: true,
  })

  const page = JSON.parse(result.result.value)
  console.log(JSON.stringify(page, null, 2))

  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(new URL('../runtime-check.png', import.meta.url), Buffer.from(screenshot.data, 'base64'))
  console.log('Screenshot saved to runtime-check.png')

  await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('.tabs button')).find((button) => button.textContent.includes('云层'))?.click()`,
  })
  await sleep(900)
  await send('Runtime.evaluate', {
    expression: `document.querySelector('.mask-editor')?.scrollIntoView({ block: 'center' })`,
  })
  await sleep(700)
  const maskScreenshot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(new URL('../runtime-check-mask.png', import.meta.url), Buffer.from(maskScreenshot.data, 'base64'))
  console.log('Mask editor screenshot saved to runtime-check-mask.png')

  const rectResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const rect = document.querySelector('.mask-canvas--paint').getBoundingClientRect()
      return JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    })()`,
    returnByValue: true,
  })
  const rect = JSON.parse(rectResult.result.value)
  const startX = rect.x + rect.width * 0.22
  const startY = rect.y + rect.height * 0.28
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: startX, y: startY, button: 'left', buttons: 1, clickCount: 1,
  })
  for (let i = 1; i <= 12; i += 1) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: startX + rect.width * 0.56 * (i / 12),
      y: startY + Math.sin(i * 0.8) * 18 + rect.height * 0.34 * (i / 12),
      button: 'left',
      buttons: 1,
    })
    await sleep(16)
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: startX + rect.width * 0.56,
    y: startY + rect.height * 0.34,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await sleep(800)

  const brushScreenshot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(new URL('../runtime-check-brush.png', import.meta.url), Buffer.from(brushScreenshot.data, 'base64'))

  const storageAfterBrush = await send('Runtime.evaluate', {
    expression: `(() => {
      const raw = localStorage.getItem('cloud-sea-terrain-generator:project:v1')
      const data = JSON.parse(raw)
      return JSON.stringify({
        maskLengths: data.bands.map((band) => band.mask.length),
        undoDisabled: document.querySelectorAll('.icon-button')[0]?.disabled,
      })
    })()`,
    returnByValue: true,
  })
  console.log(`After brush: ${storageAfterBrush.result.value}`)

  await send('Runtime.evaluate', { expression: `document.querySelectorAll('.icon-button')[0]?.click()` })
  await sleep(700)
  const storageAfterUndo = await send('Runtime.evaluate', {
    expression: `(() => {
      const raw = localStorage.getItem('cloud-sea-terrain-generator:project:v1')
      const data = JSON.parse(raw)
      return JSON.stringify({ firstMaskLength: data.bands[0].mask.length })
    })()`,
    returnByValue: true,
  })
  console.log(`After undo: ${storageAfterUndo.result.value}`)

  await send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDirectory,
    eventsEnabled: true,
  })
  await send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('导出文件'))?.click()` })
  await sleep(1400)
  const exportedName = readdirSync(downloadDirectory).find((name) => name.endsWith('.json'))
  if (!exportedName) throw new Error('Export did not download a JSON file')
  const exportPath = path.join(downloadDirectory, exportedName)
  const exportedJson = JSON.parse(readFileSync(exportPath, 'utf8'))
  if (
    exportedJson.app !== 'cloud-sea-terrain-generator' ||
    exportedJson.project.heights.length !== 65 * 65 ||
    exportedJson.project.bands.length < 2
  ) {
    throw new Error('Exported project structure is invalid')
  }
  exportedJson.project.name = 'CDP 往返导入测试'
  const importPath = path.join(downloadDirectory, 'roundtrip-import.json')
  writeFileSync(importPath, JSON.stringify(exportedJson))

  await send('DOM.enable')
  const documentTree = await send('DOM.getDocument', { depth: -1, pierce: true })
  const inputNode = await send('DOM.querySelector', {
    nodeId: documentTree.root.nodeId,
    selector: 'input[type="file"]',
  })
  await send('DOM.setFileInputFiles', { files: [importPath], nodeId: inputNode.nodeId })
  await sleep(900)
  const importResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const data = JSON.parse(localStorage.getItem('cloud-sea-terrain-generator:project:v1'))
      return JSON.stringify({ name: data.name, bands: data.bands.length, heights: data.heights.length })
    })()`,
    returnByValue: true,
  })
  console.log(`After import: ${importResult.result.value}`)
  const importedState = JSON.parse(importResult.result.value)
  if (importedState.name !== 'CDP 往返导入测试') throw new Error('Imported project name did not persist')

  if (warnings.length) console.log(`\nWARNINGS:\n${warnings.slice(0, 10).join('\n')}`)
  if (errors.length) {
    console.error(`\nRUNTIME ERRORS (${errors.length}):\n${errors.slice(0, 20).join('\n---\n')}`)
    process.exitCode = 1
  } else if (!page.text.includes('地形面板') || page.canvasCount < 1 || page.hasWebglError) {
    console.error('\nApp did not mount correctly.')
    process.exitCode = 1
  } else {
    console.log('\nRuntime smoke check passed.')
  }
  ws.close()
} catch (error) {
  console.error(error)
  if (stderr) console.error(stderr.slice(-3000))
  process.exitCode = 1
} finally {
  try {
    execFileSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    chrome.kill()
  }
}
