# Lishogi FX (userscript): notes for changes

READ THIS FIRST when the user wants changes to the lishogi script. Everything needed is in this folder; Hex Chaos is NOT needed.

## What it is
- `lishogi-fx.user.js`: a Violentmonkey/Tampermonkey userscript for lishogi.org. Random capture effects (taken from Hex Chaos, already ported here).
- Purely cosmetic (user wish, lishogi's rules): no sounds, no piece colours, no hints, no evaluation, never makes or changes moves, sends nothing anywhere.
- The user tests it on Android: Firefox + Violentmonkey. Install/update link: https://raw.githubusercontent.com/Saibrix/lishogi-fx/main/lishogi-fx.user.js
  (own public GitHub repo Saibrix/lishogi-fx, folder C:\Users\oztur\Desktop\Claude\lishogi-fx: commit + push). **Raise `@version` on every change**, otherwise Violentmonkey does not update.

## How it works
- Switch: a MutationObserver inserts `div.thick-switch.sgfx-switch` (label "Effects", input `#sgfx-toggle`) right after lishogi's "Thick" grid switch in the
  board theme menu (dasher, `.sub.theme .thick-switch`; lishogi source: ui/dasher/src/theme.ts). The menu is redrawn by snabbdom, so the observer adds it again.
  State: `localStorage['lishogiFx.on']` ('0' = off, default on).
- Capture detection (lishogi's board = shogiground, src/render.ts): every piece is `<piece class="sente pawn">` inside `<sg-pieces>`, placed with
  `transform: translate(X%, Y%)` (X/100 = column, Y/100 = row on screen). When a move animation ends, the taken piece's element is REMOVED.
  A capture = a removed piece whose square now holds a piece of the other colour (a promotion also removes an element, but the same colour stands there).
  More than 2 removals at once = a jump in the move list: ignored.
- The transform has a scale: `translate(col*100*f%, row*100*f%) scale(f)`. With lishogi's "scale down pieces" (common, e.g. desktop) f = 0.5 and the piece element is twice the square: divide by 100*f, not 100 (bug of v0.1.0: effects were far off the piece).
- The effect canvas gets its size in px from innerWidth/innerHeight, not 100vw/100vh (on phones 100vh is taller than the window and stretched the picture).
- Lishogi's squares are not square (taller than wide): use the `d-9x9` class of `.sg-wrap` and the sg-pieces rect for width and height separately.
- Piece pictures: lishogi uses CSS background images (data: URIs; gote pictures are already upside down). The script remembers the computed
  background-image of every piece kind while it is on the board (`imgCache`, key "orientation|color role"); the removed element has no style any more.
- Drawing: one fixed canvas over the whole window (z-index 2147483000, pointer-events none), only drawn while effects run.

- Speed (v0.4.0, the user saw lag on rocket/warp): the canvas runs at most at 1.25 px per CSS px (MAX_DPR); piece SVGs are turned into bitmaps once
  (`bmp()`, also the tinted ones; inferno's heat in 6 steps) because drawing the SVG scaled every frame was the big cost; the canvas is display:none while idle.
- Swing (v0.4.0): the dragged piece is `piece.dragging` in sg-board, moved with `translate(Xpx, Ypx) scale(f)`. shogiground KEEPS this element and only hides it
  (display none) between drags. We append ` translateY(28%) rotate(Ndeg) translateY(-28%)` (tilt around a point below the middle) from our own rAF loop,
  and a MutationObserver on its style puts it back whenever shogiground rewrites the transform. Speed from the translate X, smoothed, with a dead zone
  (SWING.dead px/s) so a calm finger does not wiggle; a damped spring; max SWING.max degrees. Ends on pointerup/touchend (suffix removed).

- Trail (v0.5.0): a piece gliding to its target square (click move, not dragged) has the class `anim` and shogiground rewrites its
  `translate(X%, Y%) scale(f)` every frame (X/(100f) = column as a float). `trailObs` (attributes, subtree on sg-pieces) records the positions into `trails`;
  `drawTrail` draws faded copies of the piece (bitmap) + a ribbon (white for sente, blue for gote; gold is invisible on the wood). TRAIL_LIFE = 0.3 s.

## Effects
Random from: classic (knock-away + burst by the taker: pawn stomp, lance strike, knight bounce, silver/bishop/horse slice, gold/rook/dragon ram, king royal),
flick, vortex, balloon, frost, confetti, abduct, zap (only the hit, no lightning from the mover), inferno, midas, glitch, rocket, ghost, sakura, bubble, warp (v0.2.0/0.3.0: poof and pixel removed on the user's wish; the old sink/splat cases are still in the code but not in STYLES).
LEFT OUT on purpose (they move the taking piece their own way and would fight lishogi's animation): slash, pancake, meteor, train, zap's teleport.
Also left out: hit-stop, board shake, board zoom (they would move lishogi's board).

## Testing
`node tools/fx_lishogi_test.mjs` (headless Edge, lishogi.org/analysis, plays 7g7f 3c3d Bx2b+, screenshots lfx_*.png in the scratchpad).
Only the analysis board is used for tests (never real games).

- tools/fx_drag_test.mjs [style]: drags a pawn (calm, fast, still: prints the transform), then a capture with only that style, prints frame times.
- tools/fx_lishogi_test.mjs: needs puppeteer-core (e.g. run it with the node_modules of another project, or npm i puppeteer-core here).
