# Design principles (T34 refine pass)

The user's steer: "quite professional but with a bit of an amateur look ... slight changes, a bit more professional, NOT very different from now". So the base look (dark navy surfaces, teal accent, the layout) stays and the amateur tells were removed. The rules followed, and to follow in the future:

1. **No coloured side stripes.** A role, state or type is never marked with a 2-3px coloured border on one side of a box (it was on the pair-board chat messages and on toasts). Use an avatar or icon, a small chip, a background tint, or typography.
2. **Teal means something.** The accent is for the primary action, the focus ring, the active state and progress. Secondary states are neutral greys or a desaturated tint ("finished, waiting for you" is a quiet grey pill with a teal check; the focused pane has a thin ring, no glow).
3. **Surface steps instead of outlines.** Cards, agent chips, bubbles and the board itself use a slightly lighter surface; 1px borders stay only where they separate or belong to an input. No boxes inside boxes.
4. **One hierarchy per surface: size and weight first, colour second.** Board title 18px/700 with the path muted below it, task titles 13.5px, chat bodies 14px/1.6, names 600, meta text muted.
5. **Nothing smaller than 12px** in the UI (was 10.5-11.5px in labels, times, states and paths). Terminals have their own font size setting.
6. **Rhythm in 4/8/12/16 steps**, one radius family (7/10/12), one icon weight (the 2px stroke set in `icons.js`). Pane header 36px (was 32), icon buttons 28px targets.
7. **Icons do the talking, words only where needed.** Task state is an icon (check, spinner ring, empty ring, alert), chat roles are round avatars, toasts start with a round icon (info or alert).
8. **Group instead of repeat.** Consecutive chat messages from one author within 3 minutes share one header; three identical alerts become one line with "+N" and a dismiss button; system notes are one centred muted line.
9. **Calm empty states.** A board without tasks or messages says what will appear and what the user can do, in a soft panel.
10. **Mixed Hebrew/English text gets its direction from the majority script**, not from the first letter ("T1 הושלם" is right-to-left).
11. **Check the real screenshot and ask "is this better than before?"** Before/after pairs are in `docs/screens/T34-*`; a change that is not clearly better is reverted.

## What changed in T34
Pair board (header, agent cards, alerts, task list with progress, grouped chat, compose), toasts, pane headers (36px, quieter buttons), typography floor of 12px, the neutral "finished" label, the thin focus ring. Not done on purpose: no layout changes, no new colours, no new features. Open ideas are in `docs/known-issues.md`.

## Appearance styles (T36, T49)
The user wanted "an IDE-like direction" and asked for a few real choices, not two near-identical ones (VS Code and IntelliJ differed by a handful of hex values, so IntelliJ was deleted). Settings > "תצוגה" has two rows: **מראה** (three cards with a live preview of the style's structure) and **צבע הדגשה** (the style's own accent plus six colours). Both apply instantly (a 280 ms colour transition), are saved on the server, and are applied before the first paint from the localStorage cache (a three-line script in index.html). A stored `vscode` or `intellij` migrates to `ide` (server schema alias, unit-tested).

| style | what it is |
|---|---|
| **ide** (default) | Neutral dark grey, flat, nearly square (T73: 2 px controls, chips and cards; 3-4 px dialogs, menus and tab tops; no pills except the switch and status dots; every radius goes through the --radius-* tokens in tokens.css), thin dividers, blue accent (VS Code Dark+ values). Terminal background = UI background (#1e1e1e). The structure of an IDE (status bar, tab-like pane headers, side tree) is added by T39 in `styles.css`. |
| **classic** | The original navy + teal (after T34): rounded 10 px cards, summary in the top bar. Terminal #0c0c0c. |
| **paper** | A warm LIGHT UI around DARK terminals, like paper on a desk: canvas #ece9e2, cards #f6f4ef / #ffffff, ink text, Claude terracotta accent, 12 px radius, soft shadows instead of borders. Terminals are dark cards (#1e1e1e) floating on the canvas with a light header strip; the focused pane is a stronger shadow and darker header text, never a coloured edge. The only light style, by the user's explicit grant (T49). |

How it is built (so the next change stays small):
- **Everything is a token in `public/css/tokens.css`**; `tests/unit/contrast.js` fails if any other CSS file contains a colour literal. A style is one block (`:root[data-style=...]`, plus `.st-prev[data-style=...]` so the preview cards use the same variables); the default block is IDE.
- **Structure that differs per style lives in `public/css/styles.css`** under `:root[data-style=...]`, using only tokens (paper: borderless card + `--shadow-card`, light `--pane-head-bg`; `--term-text*` is the text that sits on terminal surfaces, light in paper).
- **`--accent`** is the readable accent (text, icons, focus ring, progress); **`--accent-fill`** + **`--accent-ink`** are the primary-button fill and its text. An explicit accent colour overrides all of them; "default" uses the style's own (`--sty-accent`...). Paper has its own darker variant of every accent (`:root[data-style="paper"][data-accent=...]`, the `--sw-*` swatches of paper) so accent text passes AA on light surfaces and the ink on a fill is white.
- **Terminals follow the style only for** background, foreground, cursor and selection (`--term-*` read by `public/js/appearance.js` into the shared `THEME` and every xterm, then the RTL layer redraws). The 16 ANSI colours never change, so Claude Code looks identical in every style, including paper.
- **No other appearance option**: no per-pane colours, no profiles, no more light themes (rules in RULES.md).

### Contrast (WCAG 2), worst case over the 7 accents
Computed by `node tests/unit/contrast.js --table` from the real tokens and asserted in the test (3 styles x 7 accents). Text pairs need 4.5:1; the terminal text 7:1; "hover fill" is surface-3, the background of a hovered or pressed control (large glyphs and secondary text only, so 3:1 there). Borders are deliberately quiet (1.3:1 or more, not a WCAG requirement for decoration).

| pair | need | ide | classic | paper |
|---|---|---|---|---|
| text / surfaces | 4.5 | 7.4 | 13.3 | 12.7 |
| text-muted / surfaces | 4.5 | 5.1 | 5.4 | 5.3 |
| text-dim / surfaces | 4.5 | 4.7 | 5.2 | 4.9 |
| accent / surfaces | 4.5 | 5.6 | 7.6 | 5.5 |
| accent on accent-dim / surfaces | 4.5 | 4.7 | 6.4 | 4.8 |
| text-dim / hover fill (surface-3) | 3 | 4.0 | 4.7 | 4.7 |
| accent / hover fill (surface-3) | 3 | 4.8 | 6.8 | 4.9 |
| accent-ink on accent-fill (primary button) | 4.5 | 6.4 | 8.3 | 6.1 |
| accent-ink on accent-fill-hi (hover) | 4.5 | 4.8 | 9.9 | 7.9 |
| warn / surface-2 | 4.5 | 5.9 | 9.6 | 4.9 |
| danger / surface-2 | 4.5 | 4.7 | 6.3 | 5.6 |
| claude (agent) / surface-2 | 4.5 | 5.3 | 6.7 | 6.1 |
| shell (terminal) / surface-2 | 4.5 | 6.9 | 7.8 | 6.7 |
| warn-ink on warn | 4.5 | 7.4 | 9.6 | 4.9 |
| danger-ink on danger | 4.5 | 6.6 | 7.0 | 5.6 |
| terminal text / background (AAA) | 7 | 10.4 | 12.2 | 10.4 |
| terminal cursor / background | 3 | 7.6 | 19.6 | 7.6 |
| terminal text on selection | 4.5 | 5.3 | 5.0 | 5.3 |
| border-strong / surface-2 (quiet but visible) | 1.3 | 1.6 | 1.6 | 1.5 |

Where the original palettes failed the check they were adjusted: IDE muted/dim text and danger red lightened a little and accent tints reduced to 10%; for paper the terracotta text/fill went from #c4552b to #a74220 (the task value gave 4.1:1 as text), the dim text from #67707a to #5c6570, and the six accent swatches got darker variants (blue #1a5fb4, teal #0b6e66, violet #6b3fbf, green #18692f, amber #8c4f00, rose #b0214e).

## IDE structure (T39) and welcome-style empty states
What the **ide** style does beyond colours (all in `public/css/styles.css`, driven by `:root[data-style="ide"]`, tokens only; classic and paper do not get it):
- **Status bar** (24 px, `--surface`, 1 px top border, 12 px text) at the bottom: the summary (terminals · active · waiting for you; the waiting part is still the same button, Alt+W) moves into it from the top bar (`status.js` moves the real `#summary` element when `data-style` changes, so every test and shortcut keeps using the same node), and the quiet end side shows the connection dot, the port when it is not 7791, and the version. Hidden under 560 px of window height. Classic and paper keep the summary in the top bar and have no status bar.
- **Focused pane = a lighter header** (`--surface-3`) and brighter text; no coloured edge, no glow (the neutral `--border-strong` border stays). Unfocused names are muted; the header buttons are quiet (55 %) until hover or focus.
- **Side menu as an explorer tree**: flat and attached to the edge (no rounded card), 24 px rows, flat `--surface-3` hover, small muted title.
- **Top bar** 44 px (`--topbar-h`).
- Not done on purpose or not yet: the pane header stays 36 px in every style (the terminal size maths in `layout.js` and `duo/view.js` uses the constant `HEAD_H`; changing it per style is a bigger, riskier change than this pass), the scrollbars were already IDE-like from T25 (10 px, transparent track, no arrows; the thumb is visible at rest, not only on hover), and the top bar buttons keep their current size.

**Empty states, all three styles, the same pattern** (the VS Code "Welcome" page): no card box and no icon tile; content aligned to the start, a 20 px / 600 heading, one muted sentence, the primary button, quiet text links; generous spacing from the top (14 vh) instead of dead centre. Applies to the start screen (heading "התחלה", then the primary button, folder link, PowerShell, resume and recent lists, shortcut hints) and to the pair screen with no pairs (`.duo-empty` shares the rules).

Evidence: `docs/screens/T39-ide-{grid,board,start}-{1920,1100}.png` and `T39-ide-side-1920.png`.
