import puppeteer from 'puppeteer-core'

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:4319/'
const errors = []
const failed = []

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  defaultViewport: { width: 1680, height: 1000, deviceScaleFactor: 1 },
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
})

try {
  const page = await browser.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`))
  page.on('requestfailed', (request) => failed.push(`${request.url()} ${request.failure()?.errorText}`))

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
  await new Promise((resolve) => setTimeout(resolve, 2500))

  const canvasCount = await page.evaluate(() => document.querySelectorAll('canvas').length)
  if (canvasCount < 2) throw new Error(`Expected Konva + Three canvases, got ${canvasCount}`)

  const initial = await page.evaluate(() => {
    const s = window.__boothStore
    if (!s) throw new Error('store bridge missing')
    return {
      faces: s.studio.modelId,
      faceCount: s.getModel(s.studio.modelId).faceCount,
      texts: s.studio.doc.texts.length,
      selectedFace: s.studio.selectedFaceId,
    }
  })
  console.log('initial', initial)
  if (initial.faceCount < 24) throw new Error(`Expected dozens of faces, got ${initial.faceCount}`)
  await page.screenshot({ path: 'smoke-initial.png' })

  // Material assignment through the store must mutate the same source rendered by both views.
  await page.evaluate(() => {
    const s = window.__boothStore
    s.assignMaterial('mat-champagne', s.studio.selectedFaceId)
  })
  await new Promise((r) => setTimeout(r, 300))
  const assigned = await page.evaluate(() => {
    const s = window.__boothStore
    return s.studio.doc.assignments[s.studio.selectedFaceId]
  })
  if (assigned !== 'mat-champagne') throw new Error('material assignment did not persist')

  // Add enough text blocks to exercise the stated scale.
  await page.evaluate(() => {
    const s = window.__boothStore
    s.addDemoTexts(12)
    const first = s.studio.doc.texts[0]
    s.selectText(first.id)
    s.updateText(first.id, { fontSize: 72, letterSpacing: 18, nx: 0.52, ny: 0.46 })
  })
  await new Promise((r) => setTimeout(r, 800))

  const outlineOk = await page.evaluate(() => {
    const s = window.__boothStore
    const { getTextOutline } = window.__outlineBridge ?? {}
    return { textCount: s.studio.doc.texts.length, hasBridge: Boolean(getTextOutline) }
  })
  console.log('text state', outlineOk)

  // Real pointer drag through Konva must commit normalized coordinates on dragend.
  const dragStart = await page.evaluate(() => {
    const s = window.__boothStore
    const stage = window.__konvaStage
    const text = s.studio.doc.texts[0]
    const node = stage?.findOne(`#text-${text.id}`)
    if (!node) throw new Error('Konva text node not found')
    const p = node.absolutePosition()
    return { x: p.x, y: p.y, nx: text.nx, ny: text.ny }
  })
  const containerRect = await page.$eval('.konva-container', (el) => {
    const rect = el.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  })
  await page.mouse.move(containerRect.left + dragStart.x, containerRect.top + dragStart.y)
  await page.mouse.down()
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(
      containerRect.left + dragStart.x + step * 9,
      containerRect.top + dragStart.y + step * 4,
    )
  }
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 250))
  const dragEnd = await page.evaluate(() => {
    const text = window.__boothStore.studio.doc.texts[0]
    return { nx: text.nx, ny: text.ny }
  })
  console.log('drag', dragStart.nx, dragStart.ny, '->', dragEnd)
  if (Math.abs(dragEnd.nx - dragStart.nx) < 0.02 && Math.abs(dragEnd.ny - dragStart.ny) < 0.02) {
    throw new Error('Konva drag did not update text coordinates')
  }

  // Save scheme A, mutate, save B, then switch A and verify exact values.
  const probe = await page.evaluate(() => {
    const s = window.__boothStore
    const id = s.studio.doc.texts[0].id
    const faceId = s.studio.doc.texts[0].faceId
    s.selectFace(faceId)
    s.updateText(id, { nx: 0.52, ny: 0.46, fontSize: 72, letterSpacing: 18 })
    s.assignMaterial('mat-champagne', faceId)
    s.studio.doc.name = '冒烟方案 A'
    s.saveToSlot(0)
    const savedColor = s.studio.doc.assignments[faceId]
    s.updateText(id, { nx: 0.137, ny: 0.812, fontSize: 91, letterSpacing: 31 })
    s.assignMaterial('mat-red', faceId)
    s.saveToSlot(1)
    s.loadFromSlot(0)
    const restoredText = s.studio.doc.texts.find((t) => t.id === id)
    const restoredA = {
      color: s.studio.doc.assignments[faceId],
      nx: restoredText?.nx,
      ny: restoredText?.ny,
      fontSize: restoredText?.fontSize,
      letterSpacing: restoredText?.letterSpacing,
    }
    s.loadFromSlot(1)
    const restoredTextB = s.studio.doc.texts.find((t) => t.id === id)
    const restoredB = {
      color: s.studio.doc.assignments[faceId],
      nx: restoredTextB?.nx,
      ny: restoredTextB?.ny,
      fontSize: restoredTextB?.fontSize,
      letterSpacing: restoredTextB?.letterSpacing,
    }
    s.loadFromSlot(0)
    return {
      savedColor,
      restoredColor: restoredA.color,
      nx: restoredA.nx,
      ny: restoredA.ny,
      fontSize: restoredA.fontSize,
      letterSpacing: restoredA.letterSpacing,
      restoredB,
      slotCount: s.studio.slots.filter((x) => x.scheme).length,
    }
  })
  console.log('scheme roundtrip', probe)
  if (probe.restoredColor !== probe.savedColor) throw new Error('color was not restored from scheme A')
  if (Math.abs(probe.nx - 0.52) > 1e-9 || Math.abs(probe.ny - 0.46) > 1e-9) throw new Error('text position was not restored exactly')
  if (probe.fontSize !== 72 || probe.letterSpacing !== 18) throw new Error('text typography was not restored exactly')
  if (probe.restoredB.color !== 'mat-red') throw new Error('scheme B color was not restored')
  if (Math.abs(probe.restoredB.nx - 0.137) > 1e-9 || Math.abs(probe.restoredB.ny - 0.812) > 1e-9) {
    throw new Error('scheme B text position was not restored exactly')
  }
  if (probe.restoredB.fontSize !== 91 || probe.restoredB.letterSpacing !== 31) {
    throw new Error('scheme B typography was not restored exactly')
  }
  if (probe.slotCount !== 2) throw new Error('expected two occupied slots')

  // Export/import bundle roundtrip through the same parser used by the file input.
  const importRoundtrip = await page.evaluate(() => {
    const s = window.__boothStore
    const json = JSON.stringify(s.createExportBundle())
    const before = JSON.stringify({ model: s.studio.doc.modelId, texts: s.studio.doc.texts.length, slots: s.studio.slots.map((x) => Boolean(x.scheme)) })
    s.importJsonText(json)
    const after = JSON.stringify({ model: s.studio.doc.modelId, texts: s.studio.doc.texts.length, slots: s.studio.slots.map((x) => Boolean(x.scheme)) })
    return { before, after }
  })
  console.log('import/export', importRoundtrip)
  if (importRoundtrip.before !== importRoundtrip.after) throw new Error('bundle import did not restore equivalent state')

  // Exercise UI navigation and a real material click.
  await page.click('.steps .step-item:nth-child(2)')
  await new Promise((r) => setTimeout(r, 200))
  await page.click('.material-swatch:nth-child(4)')
  await page.click('.steps .step-item:nth-child(3)')
  await new Promise((r) => setTimeout(r, 200))
  await page.click('.text-row')
  await new Promise((r) => setTimeout(r, 150))
  await page.screenshot({ path: 'smoke-text-panel.png' })
  await page.click('.text-editor .primary-btn')
  await page.click('.steps .step-item:nth-child(4)')
  await new Promise((r) => setTimeout(r, 200))

  await page.screenshot({ path: 'smoke-preview.png', fullPage: false })

  // Every shipped booth topology must build both Konva and Three resources.
  for (const modelId of ['nebula-l', 'summit-island', 'horizon-t', 'aurora-linear']) {
    await page.evaluate((id) => window.__boothStore.chooseModel(id), modelId)
    await new Promise((resolve) => setTimeout(resolve, 650))
    await page.screenshot({ path: `smoke-${modelId}.png` })
    const canvasOk = await page.evaluate(() => document.querySelectorAll('canvas').length >= 2)
    if (!canvasOk) throw new Error(`canvases disappeared after choosing ${modelId}`)
  }

  // Reload to verify localStorage persistence does not crash hydration.
  await page.reload({ waitUntil: 'networkidle0', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1200))
  const afterReload = await page.evaluate(() => ({
    texts: window.__boothStore.studio.doc.texts.length,
    slots: window.__boothStore.studio.slots.filter((x) => x.scheme).length,
    canvases: document.querySelectorAll('canvas').length,
  }))
  console.log('after reload', afterReload)
  if (afterReload.canvases < 2) throw new Error('canvases missing after reload')

  const seriousErrors = errors.filter((text) => !text.includes('favicon.ico') && !text.includes('WebGL context'))
  if (failed.length) console.warn('failed requests', failed)
  if (seriousErrors.length) throw new Error(`Browser errors:\n${seriousErrors.slice(0, 10).join('\n')}`)

  console.log('SMOKE_OK')
} finally {
  await browser.close()
}
