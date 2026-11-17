// ==UserScript==
// @name         Lishogi FX
// @namespace    https://github.com/Saibrix/lishogi-fx
// @version      0.4.1
// @description  Random capture effects on lishogi (cosmetic only: no sounds, no hints, never touches the game)
// @match        https://lishogi.org/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/Saibrix/lishogi-fx/main/lishogi-fx.user.js
// @updateURL    https://raw.githubusercontent.com/Saibrix/lishogi-fx/main/lishogi-fx.user.js
// ==/UserScript==
// Notes for changes: see userscript/NOTES.md in the shogi repo.
(function () {
	'use strict'
	const KEY = 'lishogiFx.on'
	let on = localStorage.getItem(KEY) !== '0'
	const TAU = Math.PI * 2
	const rr = (a, b) => a + Math.random() * (b - a)
	const smooth = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c) }
	const SIDE = { sente: '#ffcf73', gote: '#8fc8ff' }

	// ---- the switch in the board theme menu, next to "thick grid" ----
	function addSwitch() {
		const thick = document.querySelector('.sub.theme .thick-switch')
		if (!thick || document.getElementById('sgfx-toggle')) return
		const box = document.createElement('div')
		box.className = 'thick-switch sgfx-switch'
		box.innerHTML = '<label for="sgfx-toggle">Effects</label><div class="switch"><input id="sgfx-toggle" class="cmn-toggle" type="checkbox"><label for="sgfx-toggle"></label></div>'
		const input = box.querySelector('input')
		input.checked = on
		input.addEventListener('change', (e) => { e.stopPropagation(); on = input.checked; localStorage.setItem(KEY, on ? '1' : '0') })
		box.addEventListener('click', (e) => e.stopPropagation())
		thick.after(box)
	}

	// ---- the effect layer: one canvas over the whole window, only drawn while something moves ----
	let cv = null, ctx = null, dpr = 1, raf = 0, last = 0
	const parts = [], rings = [], flashes = [], victims = [], bursts = [], splats = [], zaps = []
	function layer() {
		if (cv && cv.isConnected) return
		cv = document.createElement('canvas')
		cv.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483000'
		document.body.appendChild(cv)
		ctx = cv.getContext('2d')
	}
	// the layer runs at a low resolution (at most 1.25 px per CSS px): glows and sparks look the same, but phones paint far fewer pixels
	const MAX_DPR = 1.25
	function size() {
		dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
		const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr)
		if (cv.width === w && cv.height === h) return
		cv.width = w; cv.height = h
		// exactly the visible window (100vh is taller than the window on phones, which stretched the picture)
		cv.style.width = window.innerWidth + 'px'; cv.style.height = window.innerHeight + 'px'
	}
	// piece pictures are SVGs: drawing those scaled every frame is slow (warp/rocket), so each one is turned into a bitmap once
	const rasters = new WeakMap()
	function bmp(img, sz, tint) {
		if (!img || !img.complete || !img.naturalWidth) return null
		const px = Math.max(1, Math.ceil(sz * dpr)), key = px + '|' + (tint || '')
		let m = rasters.get(img)
		if (!m) rasters.set(img, (m = new Map()))
		let c = m.get(key)
		if (c) return c
		if (m.size > 24) m.clear()
		c = document.createElement('canvas'); c.width = c.height = px
		const g = c.getContext('2d')
		if (tint) { const base = bmp(img, sz); if (base) g.drawImage(base, 0, 0); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.65; g.fillStyle = tint; g.fillRect(0, 0, px, px) }
		else g.drawImage(img, 0, 0, px, px)
		m.set(key, c)
		return c
	}
	const glow = new Map()
	function glowSprite(col) {
		let s = glow.get(col)
		if (s) return s
		s = document.createElement('canvas'); s.width = s.height = 64
		const c = s.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32)
		g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, rgba(col, 0.85)); g.addColorStop(1, rgba(col, 0))
		c.fillStyle = g; c.fillRect(0, 0, 64, 64)
		glow.set(col, s)
		return s
	}
	function rgba(c, a) { const n = c.slice(1); return `rgba(${parseInt(n.slice(0, 2), 16)},${parseInt(n.slice(2, 4), 16)},${parseInt(n.slice(4, 6), 16)},${a})` }
	function particle(p, col, speed, life, sz, k = 0, g = 0) {
		const a = Math.random() * TAU, sp = speed * rr(0.35, 1)
		parts.push({ x: p[0], y: p[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: life * rr(0.7, 1), max: life, col, s: sz * rr(0.6, 1.1), k, g, rot: Math.random() * TAU, sp: rr(-10, 10) })
	}
	function kick() { if (!raf) { if (cv) cv.style.display = ''; last = performance.now(); raf = requestAnimationFrame(frame) } }
	function busy() { return parts.length || rings.length || flashes.length || victims.length || bursts.length || splats.length || zaps.length }

	// ---- the effects (from Hex Chaos; only those that leave the moving piece alone) ----
	const LEAD = 0.1          // seconds the effect is brought forward (raise it if it still feels late)
	const STYLES = ['classic', 'flick', 'vortex', 'balloon', 'frost', 'confetti', 'abduct', 'zap', 'inferno', 'midas', 'glitch', 'rocket', 'ghost', 'sakura', 'bubble', 'warp']
	function impact(p, sq, img, victimColor, moverColor, moverRole, dir) {
		layer(); size(); bmp(img, sq)          // (the bitmap is made now, not in the middle of the animation)
		const ts = sq * 0.58, col = SIDE[victimColor] || '#ffcf73', tcol = SIDE[moverColor] || '#ffffff'
		const style = STYLES[Math.floor(Math.random() * STYLES.length)]
		const V = (o) => victims.push(Object.assign({ img, sq, x: p[0], y: p[1], z: 0, vx: 0, vy: 0, vz: 0, rot: 0, vr: 0, t: 0, life: 0.6 }, o))
		const ground = (c, max, life) => rings.push({ x: p[0], y: p[1] + ts * 0.3, t: 0, col: c, max, life, flat: true })
		let [dx, dy] = dir
		switch (style) {
			case 'flick': {
				const sd = Math.random() < 0.5 ? -1 : 1
				V({ vx: dx * ts * 2.4, vy: dy * ts * 2.4, vz: ts * 3, vr: sd * 6, life: 0.5 })
				for (let i = 0; i < 4; i++) particle(p, '#ffffff', ts * 1.5, 0.35, ts * 0.06, 1)
				break
			}
			case 'sink':
				V({ mode: 'sink', life: 0.7 }); ground(col, ts * 1.3, 0.7)
				for (let i = 0; i < 6; i++) particle([p[0], p[1] + ts * 0.25], '#8a7a6a', ts * 0.9, 0.5, ts * 0.08, 2, ts * 4)
				break
			case 'splat': {
				V({ mode: 'fade', life: 0.18 })
				const blobs = [[0, 0, ts * 0.62]]
				for (let i = 0; i < 9; i++) { const an = rr(0, TAU), d = ts * rr(0.45, 1.1); blobs.push([Math.cos(an) * d, Math.sin(an) * d * 0.6, ts * rr(0.1, 0.3)]) }
				splats.push({ x: p[0], y: p[1] + ts * 0.1, t: 0, life: 1.6, col, blobs })
				for (let i = 0; i < 16; i++) particle(p, col, ts * 4, 0.6, ts * 0.11, 2, ts * 9)
				break
			}
			case 'vortex':
				V({ mode: 'spiral', life: 0.9, x0: p[0], y0: p[1] })
				for (let i = 0; i < 22; i++) { const an = rr(0, TAU), d = ts * rr(0.8, 1.6); parts.push({ x: p[0] + Math.cos(an) * d, y: p[1] + Math.sin(an) * d * 0.7, vx: -Math.sin(an) * ts * 3 - Math.cos(an) * ts * 1.6, vy: Math.cos(an) * ts * 2.1 - Math.sin(an) * ts * 1.1, life: rr(0.5, 0.9), max: 0.9, col: i % 3 ? '#b47cff' : '#ffffff', s: ts * 0.08, k: 0, g: 0, rot: 0, sp: 0 }) }
				rings.push({ x: p[0], y: p[1], t: 0, col: '#b47cff', max: ts * 1.6, life: 0.7 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.6, r: ts * 1.2, col: '#3a1466' }); break
			case 'balloon':
				V({ mode: 'float', life: 1.4 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.2, r: ts * 0.8, col: '#ffffff' })
				for (let i = 0; i < 6; i++) particle(p, '#ffffff', ts * 1.2, 0.4, ts * 0.07); break
			case 'frost':
				V({ mode: 'frozen', life: 0.8 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.35, r: ts * 1.4, col: '#bfe6ff' }); ground('#bfe6ff', ts * 1.6, 0.6)
				for (let i = 0; i < 8; i++) particle(p, '#e8f6ff', ts * 0.9, 0.6, ts * 0.06)
				setTimeout(() => { for (let i = 0; i < 20; i++) particle(p, i % 2 ? '#e8f6ff' : '#8fd0ff', ts * 3.4, 0.8, ts * 0.11, 2, ts * 7); for (let i = 0; i < 8; i++) particle(p, '#ffffff', ts * 3, 0.3, ts * 0.05, 1); kick() }, 330)
				break
			case 'confetti': {
				V({ mode: 'fade', life: 0.22 })
				const cols = ['#ff4f7b', '#ffd24a', '#5aa8ff', '#6fdc8c', '#b46cff', '#ff9a3c']
				for (let i = 0; i < 44; i++) parts.push({ x: p[0], y: p[1] - ts * 0.2, vx: rr(-1, 1) * ts * 3.6, vy: rr(-5.2, -1.6) * ts, life: rr(0.9, 1.5), max: 1.5, col: cols[i % cols.length], s: ts * rr(0.06, 0.11), k: 2, g: ts * 7, rot: rr(0, TAU), sp: rr(-14, 14) })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.25, r: ts * 1.2, col: '#fff3c4' }); ground('#ffffff', ts * 1.5, 0.4)
				break
			}
			case 'abduct':
				V({ mode: 'abduct', life: 1.3 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.5, r: ts * 1.3, col: '#a6ffb0' })
				for (let i = 0; i < 16; i++) parts.push({ x: p[0] + rr(-0.5, 0.5) * ts, y: p[1] + rr(-0.2, 0.4) * ts, vx: rr(-0.2, 0.2) * ts, vy: -rr(1.5, 3.5) * ts, life: rr(0.7, 1.2), max: 1.2, col: i % 3 ? '#c8ffd0' : '#ffffff', s: ts * rr(0.05, 0.09), k: 0, g: 0, rot: 0, sp: 0 })
				ground('#a6ffb0', ts * 1.4, 0.8); break
			case 'zap':
				V({ mode: 'ash', life: 0.85 })
				for (let k = 0; k < 4; k++) { const an = rr(0, TAU), d = ts * rr(1, 1.8); zaps.push({ pts: jagged(p, [p[0] + Math.cos(an) * d, p[1] + Math.sin(an) * d], ts * 0.25), t: 0, life: 0.35, col: '#9fe6ff', w: ts * 0.09 }) }
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.35, r: ts * 1.8, col: '#9fe6ff' })
				for (let i = 0; i < 16; i++) particle(p, i % 2 ? '#9fe6ff' : '#ffffff', ts * 3.6, 0.45, ts * 0.07, 1)
				for (let i = 0; i < 14; i++) particle(p, '#2a2a33', ts * 0.8, 1.1, ts * 0.09, 2, -ts * 2.5)
				break
			case 'inferno':
				V({ mode: 'burn', life: 1.0 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.4, r: ts * 1.6, col: '#ff7a1a' }); ground('#ff7a1a', ts * 1.5, 0.7)
				for (let i = 0; i < 26; i++) parts.push({ x: p[0] + rr(-0.35, 0.35) * ts, y: p[1] + rr(-0.1, 0.4) * ts, vx: rr(-0.3, 0.3) * ts, vy: -rr(1.2, 3.2) * ts, life: rr(0.5, 1.0), max: 1.0, col: i % 3 === 0 ? '#ffe08a' : i % 3 === 1 ? '#ff8a2a' : '#ff4a1a', s: ts * rr(0.07, 0.13), k: 0, g: -ts * 1.2, rot: 0, sp: 0 })
				for (let i = 0; i < 10; i++) particle([p[0], p[1] + ts * 0.1], '#2a2a33', ts * 0.8, 1.2, ts * 0.08, 2, -ts * 3)
				break
			case 'midas':          // gold spreads, glints, coins everywhere
				V({ mode: 'gold', life: 1.7 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.5, r: ts * 1.5, col: '#ffd24d' })
				rings.push({ x: p[0], y: p[1] + ts * 0.3, t: 0, col: '#ffd24d', max: ts * 1.5, life: 0.6, flat: true })
				setTimeout(() => {
					
					flashes.push({ x: p[0], y: p[1], t: 0, life: 0.4, r: ts * 2.2, col: '#fff0a0' })
					rings.push({ x: p[0], y: p[1] + ts * 0.2, t: 0, col: '#ffd24d', max: ts * 2.8, life: 0.6, flat: true })
					rings.push({ x: p[0], y: p[1], t: 0, col: '#ffffff', max: ts * 1.6, life: 0.4 })
					for (let i = 0; i < 26; i++) { const an = rr(0, TAU), sp = ts * rr(1.5, 5); parts.push({ x: p[0], y: p[1], vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - ts * 1.5, life: rr(0.5, 1.1), max: 1.1, col: i % 2 ? '#ffe27a' : '#ffffff', s: ts * rr(0.04, 0.08), k: 0, g: ts * 4, rot: 0, sp: 0 }) }
					
					kick()
				}, 935)
				break
			case 'glitch':
				V({ mode: 'glitch', life: 0.7 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.2, r: ts * 1.0, col: '#38f5ff' })
				for (let i = 0; i < 22; i++) parts.push({ x: p[0] + rr(-0.55, 0.55) * ts, y: p[1] + rr(-0.5, 0.5) * ts, vx: rr(-3, 3) * ts, vy: rr(-0.3, 0.3) * ts, life: rr(0.25, 0.6), max: 0.6, col: i % 2 ? '#38f5ff' : '#ff3ad0', s: ts * rr(0.05, 0.1), k: 2, g: 0, rot: 0, sp: 0 })
				break
			case 'rocket':          // a toy rocket with a big firework
				V({ mode: 'launch', life: 1.2 })
				rings.push({ x: p[0], y: p[1] + ts * 0.3, t: 0, col: '#ffb347', max: ts * 1.4, life: 0.5, flat: true })
				rings.push({ x: p[0], y: p[1] + ts * 0.3, t: 0, col: '#ffffff', max: ts * 2.2, life: 0.8, flat: true })
				setTimeout(() => {
					
					flashes.push({ x: p[0], y: p[1], t: 0, life: 0.4, r: ts * 2.2, col: '#ffb347' })
					for (let i = 0; i < 24; i++) parts.push({ x: p[0] + rr(-0.3, 0.3) * ts, y: p[1] + ts * 0.3, vx: rr(-1.6, 1.6) * ts, vy: rr(0.5, 3) * ts, life: rr(0.5, 0.9), max: 0.9, col: i % 2 ? '#ffd27a' : '#ff7a2a', s: ts * rr(0.08, 0.14), k: 0, g: 0, rot: 0, sp: 0 })
					kick()
				}, 170)
				const burst = (cx, cy, n, sz, delay) => setTimeout(() => {
					
					const cs = ['#ff4f7b', '#ffd24a', '#5aa8ff', '#6fdc8c', '#ffffff', '#b46cff']
					flashes.push({ x: cx, y: cy, t: 0, life: 0.45, r: ts * 2.4 * sz, col: '#ffe9a0' })
					rings.push({ x: cx, y: cy, t: 0, col: '#ffe9a0', max: ts * 3 * sz, life: 0.7 })
					rings.push({ x: cx, y: cy, t: 0, col: '#ff7ad9', max: ts * 1.8 * sz, life: 0.5 })
					for (let i = 0; i < n; i++) { const an = rr(0, TAU), sp = ts * rr(2.5, 6.5) * sz, c = cs[i % cs.length]; parts.push({ x: cx, y: cy, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: rr(0.7, 1.2), max: 1.2, col: c, s: ts * 0.08, k: 1, g: ts * 2.5, rot: 0, sp: 0 }); parts.push({ x: cx, y: cy, vx: Math.cos(an) * sp * 0.6, vy: Math.sin(an) * sp * 0.6, life: rr(0.8, 1.4), max: 1.4, col: c, s: ts * 0.08, k: 0, g: ts * 3, rot: 0, sp: 0 }) }
					
					kick()
				}, delay)
				burst(p[0], p[1] - ts * 5.8, 28, 1, 760); burst(p[0] - ts * 1.6, p[1] - ts * 4.8, 14, 0.55, 960); burst(p[0] + ts * 1.7, p[1] - ts * 6.4, 14, 0.55, 1100)
				break
			case 'ghost':
				V({ mode: 'ghost', life: 1.5 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.4, r: ts * 1.2, col: '#cfe0ff' })
				for (let i = 0; i < 10; i++) parts.push({ x: p[0] + rr(-0.4, 0.4) * ts, y: p[1] + rr(-0.2, 0.4) * ts, vx: rr(-0.3, 0.3) * ts, vy: -rr(0.6, 1.8) * ts, life: rr(0.8, 1.4), max: 1.4, col: '#dfe9ff', s: ts * rr(0.04, 0.08), k: 0, g: 0, rot: 0, sp: 0 })
				break
			case 'sakura':          // a storm of cherry blossoms
				V({ mode: 'sakura', life: 2.0 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.5, r: ts * 1.6, col: '#ffb2cb' })
				rings.push({ x: p[0], y: p[1] + ts * 0.3, t: 0, col: '#ffc4d8', max: ts * 2.2, life: 0.9, flat: true })
				rings.push({ x: p[0], y: p[1] + ts * 0.3, t: 0, col: '#ffffff', max: ts * 1.3, life: 0.6, flat: true })
				for (let i = 0; i < 14; i++) parts.push({ x: p[0] + rr(-0.5, 0.5) * ts, y: p[1] + rr(-0.4, 0.4) * ts, vx: rr(-0.5, 0.5) * ts, vy: -rr(0.5, 1.6) * ts, life: rr(0.9, 1.6), max: 1.6, col: '#ffd9e6', s: ts * rr(0.04, 0.07), k: 0, g: 0, rot: 0, sp: 0 })
				break
			case 'bubble':
				V({ mode: 'bubble', life: 1.3 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.25, r: ts * 0.9, col: '#bfe6ff' })
				setTimeout(() => {
					const q = [p[0] + Math.sin(0.82 * 8) * ts * 0.1, p[1] - ts * 2.6 * 0.82]
					for (let i = 0; i < 16; i++) particle(q, i % 2 ? '#dff3ff' : '#ffffff', ts * 2.6, 0.5, ts * 0.07, 1)
					rings.push({ x: q[0], y: q[1], t: 0, col: '#bfe6ff', max: ts * 1.3, life: 0.4 }); kick()
				}, 1060)
				break
			case 'warp':          // a portal, a beam, a trail of afterimages and a burst at the top
				V({ mode: 'warp', life: 0.8 })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.4, r: ts * 2, col: '#7af7ff' })
				flashes.push({ x: p[0], y: p[1], t: 0, life: 0.3, r: ts * 1.3, col: '#ff5be6' })
				rings.push({ x: p[0], y: p[1] + ts * 0.3, t: 0, col: '#7af7ff', max: ts * 2.4, life: 0.6, flat: true })
				for (let i = 0; i < 34; i++) parts.push({ x: p[0] + rr(-0.5, 0.5) * ts, y: p[1] + rr(-0.3, 0.4) * ts, vx: 0, vy: -rr(5, 12) * ts, life: rr(0.3, 0.6), max: 0.6, col: i % 3 === 0 ? '#ff5be6' : i % 3 === 1 ? '#7af7ff' : '#ffffff', s: ts * 0.06, k: 1, g: 0, rot: 0, sp: 0 })
				setTimeout(() => {
					
					const top = [p[0], p[1] - ts * 6.2]
					flashes.push({ x: top[0], y: top[1], t: 0, life: 0.5, r: ts * 2.6, col: '#ffffff' })
					rings.push({ x: top[0], y: top[1], t: 0, col: '#7af7ff', max: ts * 3, life: 0.6 })
					rings.push({ x: top[0], y: top[1], t: 0, col: '#ff5be6', max: ts * 2, life: 0.45 })
					for (let i = 0; i < 28; i++) { const an = rr(0, TAU), sp = ts * rr(3, 7); parts.push({ x: top[0], y: top[1], vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: rr(0.4, 0.8), max: 0.8, col: i % 2 ? '#7af7ff' : '#ff5be6', s: ts * 0.06, k: 1, g: 0, rot: 0, sp: 0 }); }
					kick()
				}, 420)
				break
			default: {          // classic: knocked away, shockwave, sparks and a burst that fits the taking piece
				const side = Math.random() < 0.5 ? -1 : 1
				V({ vx: dx * ts * 3.6 - dy * ts * 0.6 * side, vy: dy * ts * 3.6 + dx * ts * 0.6 * side, vz: ts * 5.2, vr: side * rr(7, 11), life: 0.62 })
				rings.push({ x: p[0], y: p[1] + ts * 0.3, t: 0, col, max: ts * 2.3, life: 0.6, flat: true })
				rings.push({ x: p[0], y: p[1] + ts * 0.3, t: 0, col: '#ffffff', max: ts * 1.4, life: 0.4, flat: true })
				flashes.push({ x: p[0], y: p[1] - ts * 0.1, t: 0, life: 0.22, r: ts * 1.1, col: '#ffffff' })
				for (let i = 0; i < 12; i++) particle(p, i % 3 ? col : '#ffffff', ts * 4.4, 0.5, ts * 0.09, 1)
				for (let i = 0; i < 14; i++) particle(p, col, ts * 3, 0.9, ts * 0.085, 2, ts * 8)
				const kind = { pawn: 'stomp', tokin: 'stomp', lance: 'strike', knight: 'bounce', silver: 'slice', bishop: 'slice', horse: 'slice', gold: 'ram', rook: 'ram', dragon: 'ram', king: 'royal' }[moverRole] || 'stomp'
				bursts.push({ kind, ts, x: p[0], y: p[1], dx, dy, t: 0, life: kind === 'ram' ? 0.6 : kind === 'slice' ? 0.5 : kind === 'strike' ? 0.65 : 0.7, col: tcol, seed: Math.floor(Math.random() * 1e9) })
			}
		}
		advance(LEAD)          // start the effect already a little way in, so it lands on time
		kick()
	}
	function jagged(a, b, jag) {
		const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d
		const n = Math.max(4, Math.round(d / (jag * 1.4))), out = [a]
		for (let i = 1; i < n; i++) { const k = i / n, o = rr(-1, 1) * jag; out.push([a[0] + (b[0] - a[0]) * k + nx * o, a[1] + (b[1] - a[1]) * k + ny * o]) }
		out.push(b); return out
	}

	function frame(now) {
		raf = 0
		const dt = Math.min(0.05, (now - last) / 1000)
		last = now
		advance(dt)
		draw()
		if (busy()) raf = requestAnimationFrame(frame)
		else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none' }          // (hidden while idle: nothing to composite)
	}
	function advance(dt) {
		const step = (arr) => { for (const x of arr) x.t += dt / x.life; for (let i = arr.length - 1; i >= 0; i--) if (arr[i].t >= 1) arr.splice(i, 1) }
		step(rings); step(flashes); step(bursts); step(splats); step(zaps)
		for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; const k = Math.pow(p.k === 2 ? 0.25 : 0.04, dt); p.vx *= k; p.vy = (p.vy + p.g * dt) * k; p.rot += p.sp * dt; p.life -= dt }
		for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1)
		for (const v of victims) { const ts = v.sq * 0.58; v.t += dt / v.life; v.x += v.vx * dt; v.y += v.vy * dt; v.vz -= ts * 17 * dt; v.z = Math.max(0, v.z + v.vz * dt); v.rot += v.vr * dt; if (v.z === 0 && v.vz < 0) v.vz *= -0.3 }
		for (let i = victims.length - 1; i >= 0; i--) if (victims[i].t >= 1) victims.splice(i, 1)
	}

	function drawPiece(img, x, y, sz, alpha) {
		const b = bmp(img, sz)
		if (!b || alpha <= 0) return
		const a = ctx.globalAlpha; ctx.globalAlpha = a * alpha; ctx.drawImage(b, x - sz / 2, y - sz / 2, sz, sz); ctx.globalAlpha = a
	}
	function tinted(img, sz, tint, alpha) {
		const b = bmp(img, sz, tint)
		if (!b || alpha <= 0) return
		const a = ctx.globalAlpha; ctx.globalAlpha = a * alpha; ctx.drawImage(b, -sz / 2, -sz / 2, sz, sz); ctx.globalAlpha = a
	}
	function drawVictim(v) {
		const k = Math.min(1, v.t), sz = v.sq, ts = sz * 0.58
		ctx.save()
		switch (v.mode) {
			case 'fade': ctx.translate(v.x, v.y); ctx.scale(1 + 0.3 * k, 1 + 0.3 * k); drawPiece(v.img, 0, 0, sz, 1 - k); break
			case 'sink': ctx.beginPath(); ctx.rect(v.x - sz, v.y - sz * 2, sz * 2, sz * 2.5); ctx.clip(); drawPiece(v.img, v.x, v.y + sz * 0.9 * k * k, sz, 1 - k * k); break
			case 'spiral': { const an = k * 9, r = ts * 0.6 * (1 - k); ctx.translate(v.x0 + Math.cos(an) * r, v.y0 + Math.sin(an) * r * 0.6); ctx.rotate(k * 14); ctx.scale(1 - k, 1 - k); drawPiece(v.img, 0, 0, sz, 1 - k * 0.5); break }
			case 'float': {
				const up = ts * 3.4 * k * k + ts * 0.5 * k, x = v.x + Math.sin(k * 9) * ts * 0.14, y = v.y - up
				ctx.globalAlpha = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3)
				const bx = x + ts * 0.12, by = y - sz * 0.9
				ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = Math.max(1, ts * 0.035)
				ctx.beginPath(); ctx.moveTo(x, y - sz * 0.35); ctx.quadraticCurveTo(x - ts * 0.18, y - sz * 0.6, bx, by + ts * 0.42); ctx.stroke()
				ctx.fillStyle = '#ff4f7b'; ctx.beginPath(); ctx.ellipse(bx, by, ts * 0.34, ts * 0.42, 0, 0, TAU); ctx.fill()
				ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(bx - ts * 0.11, by - ts * 0.15, ts * 0.07, ts * 0.13, -0.5, 0, TAU); ctx.fill()
				ctx.translate(x, y); ctx.rotate(Math.sin(k * 7) * 0.18); drawPiece(v.img, 0, 0, sz, 1 - 0.25 * k)
				break
			}
			case 'frozen': {
				const br = 0.42, sh = k > 0.18 && k < br ? Math.sin(k * 110) * ts * 0.035 : 0
				ctx.translate(v.x + sh, v.y)
				let al = 1
				if (k >= br) { const u = (k - br) / (1 - br); al = Math.max(0, 1 - u * 2.5); ctx.scale(1 + u * 0.4, 1 + u * 0.4) }
				tinted(v.img, sz, '#9fd8ff', al)
				break
			}
			case 'abduct': {
				const beam = k < 0.12 ? k / 0.12 : k > 0.85 ? Math.max(0, (1 - k) / 0.15) : 1
				const gr = ctx.createLinearGradient(v.x, v.y - ts * 7, v.x, v.y + sz * 0.5)
				gr.addColorStop(0, 'rgba(166,255,176,0)'); gr.addColorStop(1, 'rgba(166,255,176,0.5)')
				ctx.globalAlpha = beam; ctx.fillStyle = gr
				ctx.beginPath(); ctx.moveTo(v.x - ts * 0.22, v.y - ts * 7); ctx.lineTo(v.x + ts * 0.22, v.y - ts * 7); ctx.lineTo(v.x + ts * 0.8, v.y + sz * 0.5); ctx.lineTo(v.x - ts * 0.8, v.y + sz * 0.5); ctx.closePath(); ctx.fill()
				const u = Math.max(0, (k - 0.12) / 0.88), up = ts * 5 * u * u
				ctx.globalAlpha = 1; ctx.translate(v.x, v.y - up); ctx.rotate(u * 5); drawPiece(v.img, 0, 0, sz, Math.max(0, 1 - u * u))
				break
			}
			case 'burn': {
				const heat = Math.round(Math.min(1, k / 0.35) * 6) / 6, fade = k < 0.55 ? 1 : Math.max(0, 1 - (k - 0.55) / 0.45)
				ctx.translate(v.x + Math.sin(k * 60) * ts * 0.02, v.y - k * ts * 0.1); ctx.scale(1 - 0.2 * k, 1 - 0.3 * k)
				const c = (a, b) => Math.round(a * 255 * (1 - heat) + b * 255 * heat)
				tinted(v.img, sz, `rgb(${c(1, 0.12)},${c(0.5, 0.1)},${c(0.1, 0.08)})`, fade)
				break
			}
			case 'gold': {          // gold spreads up the piece, glints, then it bursts into spinning coins that bounce
				const br = 0.55, g = Math.min(1, k / 0.3), T = (k - br) * v.life
				if (k < br) {
					ctx.save(); ctx.translate(v.x + (k > 0.3 ? Math.sin(k * 90) * ts * 0.02 : 0), v.y)
					drawPiece(v.img, 0, 0, sz, 1)
					ctx.save(); ctx.beginPath(); ctx.rect(-ts, ts * 0.6 - g * ts * 1.2, ts * 2, ts * 2); ctx.clip()
					tinted(v.img, sz, '#ffc933', 1)
					ctx.restore()
					if (k > 0.3) { const sh = ((k - 0.3) / 0.25) * 2 - 1; ctx.globalAlpha = 0.7; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(sh * ts * 0.7 - ts * 0.08, -ts * 0.5); ctx.lineTo(sh * ts * 0.7 + ts * 0.1, -ts * 0.5); ctx.lineTo(sh * ts * 0.7 - ts * 0.02, ts * 0.5); ctx.lineTo(sh * ts * 0.7 - ts * 0.2, ts * 0.5); ctx.closePath(); ctx.fill() }
					ctx.restore()
					ctx.save(); ctx.globalCompositeOperation = 'lighter'
					const gl = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, ts * (0.9 + 0.5 * k)); gl.addColorStop(0, 'rgba(255,205,70,' + (0.45 * g) + ')'); gl.addColorStop(1, 'rgba(255,205,70,0)')
					ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(v.x, v.y, ts * (0.9 + 0.5 * k), 0, TAU); ctx.fill()
					const seed = Math.floor(k * 18)
					for (let i = 0; i < 5; i++) {
						const r1 = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453, a1 = r1 - Math.floor(r1), r2 = Math.sin(seed * 4.1 + i * 9.7) * 24634.6, a2 = r2 - Math.floor(r2)
						const sx = v.x + (a1 - 0.5) * ts * 1.0, sy = v.y + (a2 - 0.5) * ts * 1.0, sr = ts * (0.1 + 0.14 * ((seed + i) % 3) / 2)
						ctx.globalAlpha = 0.9; ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.moveTo(sx, sy - sr); ctx.lineTo(sx + sr * 0.18, sy - sr * 0.18); ctx.lineTo(sx + sr, sy); ctx.lineTo(sx + sr * 0.18, sy + sr * 0.18); ctx.lineTo(sx, sy + sr); ctx.lineTo(sx - sr * 0.18, sy + sr * 0.18); ctx.lineTo(sx - sr, sy); ctx.lineTo(sx - sr * 0.18, sy - sr * 0.18); ctx.closePath(); ctx.fill()
					}
					ctx.restore()
				} else {
					const fl = v.y + ts * 0.38
					for (let i = 0; i < 34; i++) {
						const a = ((i * 2.399) % TAU), sp = ts * (1.2 + 3.4 * (((i * 7) % 11) / 10)), vx = Math.cos(a) * sp * 0.9, vy = -ts * (3 + 4.5 * (((i * 5) % 9) / 8)), G = ts * 12
						let y = v.y + vy * T + 0.5 * G * T * T
						if (y > fl) y = fl - (y - fl) * 0.4
						if (T > 0.9) y = Math.min(y, fl)
						const x = v.x + vx * T * (1 - 0.25 * T), spin = T * (9 + (i % 5) * 2), w = ts * 0.2 * Math.abs(Math.cos(spin + i)), h = ts * 0.2
						ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, (1 - k) * 4))
						ctx.fillStyle = '#ffc933'; ctx.strokeStyle = '#a8740f'; ctx.lineWidth = Math.max(1, ts * 0.025)
						ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.6, w), h, 0, 0, TAU); ctx.fill(); ctx.stroke()
						ctx.fillStyle = 'rgba(255,246,190,0.8)'; ctx.beginPath(); ctx.ellipse(x - w * 0.2, y - h * 0.2, Math.max(0.3, w * 0.35), h * 0.4, 0, 0, TAU); ctx.fill()
						ctx.restore()
					}
				}
				break
			}
			case 'glitch': {
				const flick = Math.sin(k * 90) > -0.2 || k < 0.3 ? 1 : 0, out = k > 0.8 ? Math.max(0, (1 - k) / 0.2) : 1
				const seed = Math.floor(k * 16)
				const rnd = (i) => { const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return s - Math.floor(s) }
				ctx.translate(v.x, v.y)
				for (const [gc, off] of [['#38f5ff', -1], ['#ff3ad0', 1]]) { ctx.save(); ctx.translate(off * ts * (0.08 + 0.12 * rnd(9)), 0); tinted(v.img, sz, gc, 0.45 * out * flick); ctx.restore() }
				const n = 6
				for (let i = 0; i < n; i++) {
					ctx.save(); ctx.beginPath(); ctx.rect(-sz, -sz * 0.5 + (i / n) * sz, sz * 2, sz / n + 0.5); ctx.clip()
					ctx.translate((rnd(i) - 0.5) * ts * 0.5 * Math.min(1, k * 3), 0)
					drawPiece(v.img, 0, 0, sz, out * flick); ctx.restore()
				}
				ctx.save(); ctx.globalCompositeOperation = 'lighter'
				const sy = -ts * 0.6 + ((k * 2.6) % 1) * ts * 1.2
				ctx.globalAlpha = 0.5 * out * flick; ctx.fillStyle = '#7af7ff'; ctx.fillRect(-ts * 0.6, sy, ts * 1.2, ts * 0.06)
				for (let i = 0; i < 3; i++) { ctx.globalAlpha = 0.85 * out * flick; ctx.fillStyle = ['#38f5ff', '#ff3ad0', '#ffffff'][i]; ctx.fillRect((rnd(20 + i) - 0.5) * ts * 1.0, (rnd(30 + i) - 0.5) * ts * 0.9, ts * (0.1 + 0.14 * rnd(40 + i)), ts * 0.04) }
				ctx.restore()
				break
			}
			case 'launch': {          // a toy rocket: rumbles, lifts off with a smoke trail and a big flame
				const u = Math.max(0, Math.min(1, (k - 0.14) / 0.5)), upAt = (t) => ts * 5.8 * Math.pow(t, 2.1), fade = k < 0.62 ? 1 : Math.max(0, 1 - (k - 0.62) / 0.06)
				if (u > 0) for (let j = 14; j >= 1; j--) {
					const tj = u - j * 0.04
					if (tj <= 0) continue
					const r = ts * (0.1 + 0.3 * j / 14), age = j / 14
					ctx.save(); ctx.globalAlpha = 0.45 * (1 - age) * Math.min(1, (1 - k) * 3)
					ctx.fillStyle = j % 2 ? '#e8e8ee' : '#b9bcc8'; ctx.beginPath(); ctx.arc(v.x + Math.sin(j * 2.1) * ts * 0.12, v.y - upAt(tj) + ts * 0.35, r, 0, TAU); ctx.fill(); ctx.restore()
				}
				if (fade <= 0) break
				const sh = k < 0.14 ? Math.sin(k * 260) * ts * 0.035 : 0
				ctx.globalAlpha = fade; ctx.translate(v.x + sh, v.y - upAt(u))
				if (k > 0.1) {
					const fl = ts * (0.7 + 1.3 * u) * (0.8 + 0.2 * Math.sin(k * 90)), gr = ctx.createLinearGradient(0, ts * 0.45, 0, ts * 0.45 + fl)
					gr.addColorStop(0, 'rgba(255,250,200,1)'); gr.addColorStop(0.35, 'rgba(255,170,50,0.9)'); gr.addColorStop(1, 'rgba(255,60,20,0)')
					ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(-ts * 0.3, ts * 0.45); ctx.quadraticCurveTo(0, ts * 0.45 + fl * 1.1, ts * 0.3, ts * 0.45); ctx.closePath(); ctx.fill()
				}
				ctx.save(); ctx.scale(1 - 0.12 * u, 1 + 0.3 * u)
				drawPiece(v.img, 0, 0, sz, 1)
				ctx.restore()
				ctx.fillStyle = '#ff4f4f'; ctx.strokeStyle = '#7a1414'; ctx.lineWidth = Math.max(1, ts * 0.03)
				ctx.beginPath(); ctx.moveTo(-ts * 0.26, -ts * 0.5); ctx.lineTo(0, -ts * 1.05); ctx.lineTo(ts * 0.26, -ts * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke()
				for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * ts * 0.4, ts * 0.1); ctx.lineTo(sd * ts * 0.68, ts * 0.58); ctx.lineTo(sd * ts * 0.4, ts * 0.45); ctx.closePath(); ctx.fill(); ctx.stroke() }
				break
			}
			case 'ghost': {
				const up = ts * 2.2 * k, x = v.x + Math.sin(k * 11) * ts * 0.18 * (0.4 + k)
				ctx.translate(x, v.y - up); ctx.rotate(Math.sin(k * 8) * 0.12); ctx.scale(1 - 0.1 * k, 1 + 0.18 * k)
				const al = Math.max(0, (k < 0.15 ? 0.45 + k * 2 : 0.75) * (1 - Math.max(0, (k - 0.5) / 0.5)))
				tinted(v.img, sz, '#b8d0ff', al)
				ctx.fillStyle = '#10131f'; ctx.globalAlpha = al * 0.9
				for (const ex of [-0.12, 0.12]) { ctx.beginPath(); ctx.ellipse(ex * ts, -ts * 0.08, ts * 0.045, ts * 0.075, 0, 0, TAU); ctx.fill() }
				ctx.beginPath(); ctx.ellipse(0, ts * 0.1, ts * 0.05, ts * 0.07, 0, 0, TAU); ctx.fill()
				break
			}
			case 'bubble': {
				const x = v.x + Math.sin(k * 8) * ts * 0.1, y = v.y - ts * 2.6 * k, pop = k > 0.82
				ctx.translate(x, y); ctx.scale(0.9, 0.9)
				drawPiece(v.img, 0, 0, sz, pop ? Math.max(0, 1 - (k - 0.82) / 0.1) : 1)
				if (!pop) {
					const r = ts * 0.68, gr = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r)
					gr.addColorStop(0, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.7, 'rgba(170,220,255,0.15)'); gr.addColorStop(1, 'rgba(170,220,255,0.4)')
					ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill()
					ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = Math.max(1, ts * 0.03); ctx.stroke()
					ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 3.6, 4.4); ctx.stroke()
				}
				break
			}
			case 'sakura': {          // a storm of cherry blossoms spirals up around the piece, which turns pale pink and dissolves into petals
				const dis = Math.max(0, Math.min(1, (k - 0.12) / 0.5)), ctr = [v.x, v.y - ts * 0.2 - ts * 0.8 * k]
				ctx.save(); ctx.globalCompositeOperation = 'lighter'
				const gl = ctx.createRadialGradient(ctr[0], ctr[1], 0, ctr[0], ctr[1], ts * (1 + 1.6 * k))
				gl.addColorStop(0, 'rgba(255,170,205,' + (0.4 * (1 - k)) + ')'); gl.addColorStop(1, 'rgba(255,170,205,0)')
				ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(ctr[0], ctr[1], ts * (1 + 1.6 * k), 0, TAU); ctx.fill(); ctx.restore()
				ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(Math.sin(k * 10) * 0.1 * dis); ctx.scale(1 - 0.15 * dis, 1 - 0.15 * dis)
				tinted(v.img, sz, '#ff9fc0', 1 - dis)
				ctx.restore()
				for (let i = 0; i < 90; i++) {
					const sd = i * 2.399, born = (i % 14) / 14 * 0.45, u = (k - born) / (1 - born)
					if (u <= 0) continue
					const ang = sd + u * (5 + (i % 4)), rad = ts * (0.15 + 1.5 * Math.pow(u, 0.7)) * (0.6 + 0.4 * ((i * 7) % 5) / 4)
					const px = v.x + Math.cos(ang) * rad + u * ts * 1.8, py = v.y - ts * 0.1 - u * ts * 2.6 * (0.6 + 0.4 * ((i * 3) % 5) / 4) + Math.sin(ang) * rad * 0.35 + u * u * ts * 1.1
					const s = ts * (0.2 + 0.12 * ((i * 5) % 4) / 3), fl = Math.cos(u * 9 + i)
					ctx.save(); ctx.translate(px, py); ctx.rotate(ang * 0.7 + i); ctx.scale(1, 0.25 + 0.75 * Math.abs(fl))
					ctx.globalAlpha = Math.min(1, u * 8) * Math.min(1, (1 - u) * 2.5)
					ctx.fillStyle = i % 3 === 0 ? '#ffe9f1' : i % 3 === 1 ? '#ffb2cb' : '#ff8fb3'
					ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.95, -s * 0.5, s * 0.15, s); ctx.lineTo(0, s * 0.72); ctx.lineTo(-s * 0.15, s); ctx.quadraticCurveTo(-s * 0.95, -s * 0.5, 0, -s); ctx.fill()
					ctx.restore()
				}
				break
			}
			case 'warp': {          // a portal opens, the piece is squeezed into a beam and shot up in a trail of afterimages
				const open = Math.min(1, k * 7) * (1 - Math.max(0, (k - 0.75) / 0.25)), u = Math.max(0, Math.min(1, (k - 0.12) / 0.5))
				ctx.save(); ctx.globalCompositeOperation = 'lighter'
				for (let r = 0; r < 3; r++) {
					const rad = ts * (0.95 - r * 0.22) * open
					if (rad <= 0.5) continue
					ctx.setLineDash([ts * 0.22, ts * 0.13]); ctx.lineDashOffset = -k * ts * 7 * (r % 2 ? 1 : -1)
					ctx.strokeStyle = r === 1 ? '#ff5be6' : '#7af7ff'; ctx.globalAlpha = 0.9 * open; ctx.lineWidth = Math.max(1.5, ts * 0.07)
					ctx.beginPath(); ctx.ellipse(v.x, v.y + ts * 0.3, rad, rad * 0.45, 0, 0, TAU); ctx.stroke()
				}
				ctx.setLineDash([])
				const bw = ts * 0.85 * (1 - 0.7 * u) * (k < 0.85 ? 1 : Math.max(0, (1 - k) / 0.15)), gr = ctx.createLinearGradient(0, v.y - ts * 10, 0, v.y + ts * 0.4)
				gr.addColorStop(0, 'rgba(122,247,255,0)'); gr.addColorStop(0.65, 'rgba(170,250,255,0.7)'); gr.addColorStop(1, 'rgba(255,91,230,0.5)')
				ctx.globalAlpha = Math.min(1, k * 8); ctx.fillStyle = gr; ctx.fillRect(v.x - bw, v.y - ts * 10, bw * 2, ts * 10.4)
				ctx.globalAlpha = Math.min(1, k * 8) * 0.9; ctx.fillStyle = '#ffffff'; ctx.fillRect(v.x - bw * 0.18, v.y - ts * 10, bw * 0.36, ts * 10.4)
				ctx.restore()
				for (let i = 6; i >= 0; i--) {
					const t = u - i * 0.055
					if (t <= 0) continue
					const up = ts * 9 * t * t, al = (i === 0 ? 1 : 0.5 * (1 - i / 7)) * (1 - t * t)
					ctx.save(); ctx.translate(v.x, v.y - up); ctx.scale(Math.max(0.05, 1 - 1.7 * t), 1 + 4 * t)
					drawPiece(v.img, 0, 0, sz, al)
					ctx.restore()
				}
				break
			}
			case 'ash': ctx.translate(v.x, v.y); ctx.scale(1 - 0.25 * k, 1 - 0.25 * k); tinted(v.img, sz, '#2a2a33', 1 - k); break
			default: {
				const al = Math.min(1, (1 - k) * 2.6)
				ctx.globalAlpha = al * 0.35; ctx.fillStyle = '#000'
				ctx.beginPath(); ctx.ellipse(v.x, v.y + sz * 0.4, ts * 0.42 * (1 - Math.min(0.6, v.z / (ts * 3))), ts * 0.17, 0, 0, TAU); ctx.fill()
				ctx.globalAlpha = 1; ctx.translate(v.x, v.y - v.z); ctx.rotate(v.rot); const sc = 1 - 0.3 * k; ctx.scale(sc, sc)
				drawPiece(v.img, 0, 0, sz, al)
			}
		}
		ctx.restore()
	}
	function draw() {
		size()
		ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height)
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		for (const s of splats) {
			const al = s.t < 0.6 ? 1 : 1 - (s.t - 0.6) / 0.4, grow = Math.min(1, s.t / 0.06)
			ctx.save(); ctx.globalAlpha = 0.85 * al; ctx.fillStyle = s.col
			for (const b of s.blobs) { ctx.beginPath(); ctx.ellipse(s.x + b[0] * grow, s.y + b[1] * grow, b[2] * grow, b[2] * 0.6 * grow, 0, 0, TAU); ctx.fill() }
			ctx.restore()
		}
		for (const p of parts) if (p.k === 2) {
			const age = 1 - p.life / p.max
			ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = smooth(age / 0.06) * Math.min(1, (p.life / p.max) * 2.5)
			ctx.fillStyle = p.col; ctx.fillRect(-p.s, -p.s * 0.6, p.s * 2, p.s * 1.2); ctx.restore()
		}
		for (const v of victims) drawVictim(v)
		ctx.globalCompositeOperation = 'lighter'
		for (const f of flashes) { const a = smooth(f.t / 0.1) * Math.pow(1 - f.t, 2), r = f.r * (0.45 + 0.75 * (1 - Math.pow(1 - f.t, 3))); ctx.globalAlpha = Math.min(1, a); ctx.drawImage(glowSprite(f.col), f.x - r, f.y - r, r * 2, r * 2) }
		for (const r of rings) {
			const k = r.t, base = r.max * 0.13, rad = Math.max(0.5, base + (r.max - base) * (1 - Math.pow(1 - k, 3))), a = smooth(k / 0.12) * Math.pow(1 - k, 1.4), w = Math.max(2, r.max * 0.05) * (1 - k * 0.7)
			ctx.globalAlpha = a * 0.28; ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, r.flat ? rad * 0.5 : rad, 0, 0, TAU); ctx.strokeStyle = r.col; ctx.lineWidth = w * 2.6; ctx.stroke()
			ctx.globalAlpha = a * 0.9; ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, r.flat ? rad * 0.5 : rad, 0, 0, TAU); ctx.lineWidth = w; ctx.stroke()
		}
		for (const b of bursts) drawBurst(b)
		ctx.globalCompositeOperation = 'lighter'
		for (const z of zaps) {
			const a = smooth(z.t / 0.05) * Math.pow(1 - z.t, 1.2)
			const line = (w, col, al) => { ctx.globalAlpha = al; ctx.beginPath(); z.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke() }
			line(z.w * 3.2, z.col, 0.2 * a); line(z.w * 1.5, z.col, 0.6 * a); line(Math.max(1.5, z.w * 0.6), '#ffffff', a)
		}
		for (const p of parts) {
			if (p.k === 2) continue
			const age = 1 - p.life / p.max, left = Math.max(0, p.life / p.max), a = smooth(age / 0.07) * Math.pow(left, 1.2)
			if (a <= 0.003) continue
			ctx.globalAlpha = Math.min(1, a)
			if (p.k === 1) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05); ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1.5, p.s * 0.5); ctx.lineCap = 'round'; ctx.stroke() }
			else { const r = p.s * (1.8 + 1.2 * Math.sin(Math.min(1, age * 3) * 1.4)) * (0.5 + 0.5 * left); ctx.drawImage(glowSprite(p.col), p.x - r, p.y - r, r * 2, r * 2) }
		}
		ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
	}
	function drawBurst(b) {
		const k = b.t, fade = smooth(1 - k), out = 1 - Math.pow(1 - k, 3), env = smooth(k / 0.1), ts = (b.ts || 30), x = b.x, y = b.y
		let s = (b.seed >>> 0) || 1
		const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
		ctx.save(); ctx.globalCompositeOperation = 'lighter'
		const line = (x0, y0, x1, y1, c, w) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineCap = 'round'; ctx.globalAlpha = 0.22 * env; ctx.strokeStyle = c; ctx.lineWidth = w * 2.6; ctx.stroke(); ctx.globalAlpha = env; ctx.lineWidth = w; ctx.stroke() }
		const arcs = (r, c, w) => { if (r <= 0) return; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = c; ctx.globalAlpha = 0.22 * env; ctx.lineWidth = Math.max(w, 0.5) * 2.6; ctx.stroke(); ctx.globalAlpha = env; ctx.lineWidth = Math.max(w, 0.5); ctx.stroke() }
		const col = b.col
		switch (b.kind) {
			case 'ram': {
				const sx = -b.dy, sy = b.dx
				for (let i = 0; i < 6; i++) { const off = (i - 2.5) * ts * 0.17; line(x - b.dx * ts * (0.3 + 1.6 * out) + sx * off, y - b.dy * ts * (0.3 + 1.6 * out) + sy * off, x - b.dx * ts * (0.1 + 0.5 * out) + sx * off * (1 + out), y - b.dy * ts * (0.1 + 0.5 * out) + sy * off * (1 + out), rgba(col, 0.9 * fade), Math.max(2, ts * 0.07)) }
				arcs(ts * (0.2 + 1.5 * out), rgba(col, fade), Math.max(2.5, ts * 0.2 * fade)); break
			}
			case 'slice':
				for (let n = 0; n < 2; n++) {
					const dx = Math.SQRT1_2, dy = (n === 0 ? 1 : -1) * Math.SQRT1_2, reach = ts * 1.5, head = Math.max(0, Math.min(1, k * 3 - n * 0.7))
					if (head <= 0) continue
					const a = Math.max(0, Math.min(1, fade * 1.6))
					line(x - dx * reach, y - dy * reach, x - dx * reach + dx * reach * 2 * head, y - dy * reach + dy * reach * 2 * head, `rgba(255,255,255,${a})`, Math.max(2, ts * 0.09))
				}
				break
			case 'bounce':
				for (let n = 0; n < 2; n++) {
					const kk = Math.max(0, Math.min(1, k * 1.4 - n * 0.2)); if (kk <= 0) continue
					const o = 1 - Math.pow(1 - kk, 2)
					ctx.beginPath(); ctx.ellipse(x, y, ts * (0.3 + 1.3 * o), ts * (0.15 + 0.6 * o), 0, 0, TAU)
					ctx.globalAlpha = env; ctx.strokeStyle = rgba(col, 0.9 * (1 - kk)); ctx.lineWidth = Math.max(2, ts * 0.12 * (1 - kk)); ctx.stroke()
				}
				break
			case 'strike': {
				const top = [x + (rnd() * 0.6 - 0.3) * ts, y - ts * 3.2], pts = [top]
				for (let i = 1; i < 7; i++) { const f = i / 6, jit = (rnd() - 0.5) * ts * 0.7 * (1 - f); pts.push([top[0] + (x - top[0]) * f + jit, top[1] + (y - top[1]) * f]) }
				const flash = k < 0.45 ? 1 : Math.max(0, Math.min(1, (0.7 - k) / 0.25))
				ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.globalAlpha = env; ctx.strokeStyle = `rgba(255,255,255,${flash})`; ctx.lineWidth = Math.max(2, ts * 0.1); ctx.stroke()
				arcs(ts * (0.3 + 1.2 * out), rgba(col, fade), Math.max(2, ts * 0.1 * fade)); break
			}
			case 'royal':
				arcs(ts * (0.3 + 1.4 * out), rgba('#ffd24d', fade), Math.max(2, ts * 0.16 * fade)); break
			default:
				for (let i = 0; i < 7; i++) {
					const a = rnd() * TAU, len = ts * (0.7 + rnd() * 0.6) * out
					ctx.beginPath(); ctx.moveTo(x, y)
					for (let j = 1; j < 4; j++) { const aa = a + (rnd() - 0.5) * 0.7; ctx.lineTo(x + Math.cos(aa) * len * j / 3, y + Math.sin(aa) * len * j / 3) }
					ctx.globalAlpha = env; ctx.strokeStyle = rgba(col, fade); ctx.lineWidth = Math.max(2, ts * 0.08 * fade + 1); ctx.lineJoin = 'round'; ctx.stroke()
				}
				arcs(ts * (0.3 + 0.9 * out), `rgba(217,191,153,${0.5 * fade})`, Math.max(2, ts * 0.12 * fade))
		}
		ctx.restore()
	}

	// ---- swing: the piece in the finger tilts a little, its tip trails behind the finger ----
	// shogiground moves the dragged piece (piece.dragging in sg-board) with transform: translate(Xpx, Ypx) scale(f).
	// We add a tilt around a point below its middle; an observer puts it back at once whenever shogiground rewrites the transform.
	const SWING = { max: 24, gain: 0.042, dead: 70, pivot: '28%' }          // degrees at most, degrees per px/s, px/s that are ignored (a calm finger does not wiggle)
	const SUFFIX = / translateY\(28%\).*$/
	let sw = null
	function swingApply(s) {
		const el = s.el, base = el.style.transform.replace(SUFFIX, '')
		const want = Math.abs(s.ang) < 0.05 ? base : `${base} translateY(${SWING.pivot}) rotate(${s.ang.toFixed(2)}deg) translateY(-${SWING.pivot})`
		if (el.style.transform !== want) el.style.transform = want
	}
	function swingEnd() {
		const s = sw
		sw = null
		if (!s) return
		if (s.mo) s.mo.disconnect()
		if (s.el && s.el.isConnected) s.el.style.transform = s.el.style.transform.replace(SUFFIX, '')
	}
	function swingFrame(now) {
		const s = sw
		if (!s) return
		const dt = Math.min(1 / 30, Math.max(1 / 240, (now - s.last) / 1000))
		s.last = now
		if (!s.el) {
			const el = document.querySelector('piece.dragging')
			if (!el) { if (now - s.start > 3000) { swingEnd(); return } s.raf = requestAnimationFrame(swingFrame); return }
			s.el = el
			s.mo = new MutationObserver(() => { if (sw === s && s.shown) swingApply(s) })
			s.mo.observe(el, { attributes: true, attributeFilter: ['style'] })
		}
		if (!s.el.isConnected || !s.el.classList.contains('dragging')) { swingEnd(); return }
		// shogiground keeps this element and only hides it between drags: wait until it is shown
		s.shown = getComputedStyle(s.el).display !== 'none'
		if (!s.shown) { s.x = null; s.v = s.ang = s.vel = 0; if (now - s.start > 3000) { swingEnd(); return } s.raf = requestAnimationFrame(swingFrame); return }
		const m = /translate\(\s*(-?[\d.]+)px/.exec(s.el.style.transform)
		const x = m ? Number(m[1]) : s.x
		if (s.x === null) s.x = x
		const raw = (x - s.x) / dt
		s.x = x
		s.v += (raw - s.v) * (1 - Math.exp(-dt * 30))          // smoothed speed (quick to react)
		const over = Math.max(0, Math.abs(s.v) - SWING.dead)
		const target = -Math.sign(s.v) * Math.min(SWING.max, over * SWING.gain)
		s.vel += (-(s.ang - target) * 700 - s.vel * 30) * dt          // a soft spring: swings a little past, then settles
		s.ang += s.vel * dt
		swingApply(s)
		s.raf = requestAnimationFrame(swingFrame)
	}
	function swingStart() {
		if (!on || sw) return
		const t = performance.now()
		sw = { el: null, mo: null, x: null, v: 0, ang: 0, vel: 0, last: t, start: t, raf: 0, shown: false }
		sw.raf = requestAnimationFrame(swingFrame)
	}
	for (const ev of ['pointerdown', 'touchstart', 'mousedown']) window.addEventListener(ev, swingStart, { capture: true, passive: true })
	for (const ev of ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup']) window.addEventListener(ev, swingEnd, { capture: true, passive: true })

	// ---- watching the board ----
	// shogiground places every piece with transform: translate(x%, y%) (x/100 = column, y/100 = row on screen).
	// A capture: when the move animation ends, the taken piece's element is removed, and a piece of the other colour stands on its square.
	const imgCache = new Map()          // "orientation|color role" -> the picture of that piece
	const ROLES = ['pawn', 'lance', 'knight', 'silver', 'gold', 'bishop', 'rook', 'king', 'tokin', 'promotedlance', 'promotedknight', 'promotedsilver', 'horse', 'dragon']
	function pieceInfo(el) {
		const cl = el.classList
		const color = cl.contains('sente') ? 'sente' : cl.contains('gote') ? 'gote' : ''
		const role = ROLES.find((r) => cl.contains(r)) || ''
		// translate(col * 100 * f %, row * 100 * f %) scale(f): with "scale down pieces" lishogi draws pieces twice as big and f = 0.5
		const tr = el.style.transform || ''
		const m = /translate\(\s*(-?[\d.]+)%\s*,\s*(-?[\d.]+)%/.exec(tr)
		const sc = /scale\(\s*([\d.]+)/.exec(tr)
		const f = sc ? Number(sc[1]) || 1 : 1
		return { color, role, col: m ? Math.round(Number(m[1]) / (100 * f)) : -1, row: m ? Math.round(Number(m[2]) / (100 * f)) : -1 }
	}
	const wrapOf = (piecesEl) => piecesEl.closest('.sg-wrap')
	const orient = (piecesEl) => { const w = wrapOf(piecesEl); return w && w.classList.contains('orientation-gote') ? 'g' : 's' }
	function remember(piecesEl) {
		const o = orient(piecesEl)
		for (const el of piecesEl.children) {
			if (el.tagName !== 'PIECE') continue
			const i = pieceInfo(el), key = `${o}|${i.color} ${i.role}`
			if (imgCache.has(key)) continue
			const bg = getComputedStyle(el).backgroundImage
			const m = /url\(["']?(.*?)["']?\)/.exec(bg || '')
			if (!m) continue
			const img = new Image(); img.src = m[1]
			imgCache.set(key, img)
		}
	}
	function onChange(piecesEl, removed) {
		remember(piecesEl)
		if (!on || !removed.length || removed.length > 2) return          // (many at once: a jump in the move list, not a capture)
		const rect = piecesEl.getBoundingClientRect()
		if (!rect.width) return
		const dm = /d-(\d+)x(\d+)/.exec(wrapOf(piecesEl)?.className || '')
		const sw = rect.width / (dm ? Number(dm[1]) : 9), sh = rect.height / (dm ? Number(dm[2]) : 9)          // (lishogi's squares are a little taller than wide)
		const sq = Math.min(sw, sh)
		const now = [...piecesEl.children].filter((e) => e.tagName === 'PIECE' && !e.classList.contains('ghost')).map(pieceInfo)
		for (const el of removed) {
			const v = pieceInfo(el)
			if (v.col < 0 || !v.color) continue
			const mover = now.find((p) => p.col === v.col && p.row === v.row && p.color && p.color !== v.color)
			if (!mover) continue          // no piece of the other side there: a promotion or a jump, not a capture
			const p = [rect.left + (v.col + 0.5) * sw, rect.top + (v.row + 0.5) * sh]
			const img = imgCache.get(`${orient(piecesEl)}|${v.color} ${v.role}`)
			const dir = [0, (mover.color === 'sente') === (orient(piecesEl) === 's') ? -1 : 1]          // the push goes the way the taker moves
			impact(p, sq, img, v.color, mover.color, mover.role, dir)
		}
	}
	const obs = new MutationObserver((list) => {
		addSwitch()
		const byBoard = new Map()
		for (const m of list) {
			const t = m.target
			if (!(t instanceof Element) || t.tagName !== 'SG-PIECES') continue
			const arr = byBoard.get(t) || []
			for (const n of m.removedNodes) if (n.nodeType === 1 && n.tagName === 'PIECE') arr.push(n)
			byBoard.set(t, arr)
		}
		for (const [el, removed] of byBoard) onChange(el, removed)
	})
	obs.observe(document.body, { childList: true, subtree: true })
	for (const el of document.querySelectorAll('sg-pieces')) remember(el)
	addSwitch()
	window.addEventListener('resize', () => { if (cv) size() })
})()
