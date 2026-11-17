// temp probe: swing while dragging + rocket/warp captures without errors
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
const OUT = 'C:/Users/oztur/AppData/Local/Temp/claude/60d8c521320e44a2/1c0bc40e-f7be-45ef-a62b-21f2a434aaa2/scratchpad'
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => { try { readFileSync(p); return true } catch { return false } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 860, deviceScaleFactor: 2 })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
await page.setBypassCSP(true)
await page.goto('https://lishogi.org/analysis', { waitUntil: 'networkidle2' })
const src = readFileSync('C:/Users/oztur/Desktop/Claude/lishogi-fx/lishogi-fx.user.js', 'utf8').replace(/const STYLES = \[[^\]]*\]/, "const STYLES = ['" + (process.argv[2] || 'rocket') + "']")
await page.addScriptTag({ content: src })
await sleep(500)
const r = await page.evaluate(() => { const b = document.querySelector('sg-pieces').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } })
const at = (file, rank) => [r.x + (9 - file + 0.5) * r.w / 9, r.y + (rank - 0.5) * r.h / 9]
const tf = () => page.evaluate(() => document.querySelector('piece.dragging')?.style.transform || '-')
// drag 7g: calm, then fast sideways, then hold still
const [x0, y0] = at(7, 7)
await page.mouse.move(x0, y0); await page.mouse.down()
for (let i = 1; i <= 6; i++) { await page.mouse.move(x0, y0 - i); await sleep(16) }
console.log('calm  :', await tf())
for (let i = 1; i <= 8; i++) { await page.mouse.move(x0 + i * 14, y0 - 6); await sleep(16) }
console.log('fast  :', await tf())
await page.screenshot({ path: `${OUT}/swing_fast.png` })
await sleep(500)
console.log('still :', await tf())
await page.mouse.move(...at(7, 6)); await sleep(30); await page.mouse.up(); await sleep(300)
console.log('after :', await page.evaluate(() => [...document.querySelectorAll('piece')].filter((e) => /rotate/.test(e.style.transform)).map((e) => e.className + ' @' + e.parentElement.tagName + ' ' + e.style.transform + ' vis=' + getComputedStyle(e).visibility + getComputedStyle(e).display).join(' | ') + ' <- rotated left'))
// capture: 3c3d, bishop takes bishop
const click = async (f, k) => { const [x, y] = at(f, k); await page.mouse.move(x, y); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(250) }
await click(3, 3); await click(3, 4); await sleep(500)
await click(8, 8); await click(2, 2); await sleep(200)
const promo = await page.$('sg-promotion piece'); if (promo) await promo.click()
// frame times during the effect
const ft = await page.evaluate(() => new Promise((res) => { const t = []; let l = performance.now(); const f = (n) => { t.push(n - l); l = n; if (t.length < 90) requestAnimationFrame(f); else res(t) }; requestAnimationFrame(f) }))
console.log('frames: avg', (ft.reduce((a, b) => a + b, 0) / ft.length).toFixed(1), 'ms, worst', Math.max(...ft).toFixed(1), 'ms')
await page.screenshot({ path: `${OUT}/fx_${process.argv[2] || 'rocket'}.png` })
await browser.close()
