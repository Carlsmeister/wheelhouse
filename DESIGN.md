# Design

A native-feeling macOS tool. The agents' work is the content; the chrome recedes. All values live as tokens at the top of `src/styles.css`, defined for dark and for `:root[data-theme='light']`; `src/marin.css`, imported after it, overrides them with the fork's Marin values and defines the fork's own tokens beside them (`--accent-2`, `--on-accent`, `--glow`, `--glow-soft`, `--pill-tint`, `--group-0` to `--group-7`; issue #9). The theme follows the Mac unless Settings says otherwise (`src/theme.ts`).

## Look

Cool navy and blue-grey (Marin), not flat grey: the interface floats over the board in pills and capsules of glass, with soft continuous corners. The material is Apple's (blur, a thin light rim, a highlight on the top edge); the character is its own (blue, coloured chips, agents tinting their console's frame). The day theme is the same design on cool paper.

## Colour

- Neutrals carry the interface: `--bg`, `--panel`, `--panel-2`, `--panel-3`, `--line`, `--line-2`, `--text`, `--text-2`, `--muted`, `--faint`.
- `--ink` is the theme's foreground as RGB channels, for translucent hover and fill states: `rgb(var(--ink) / 0.08)`. Never write a translucent white.
- Blue (`--accent`, with `--accent-2` as the end of its gradient) goes on the primary action, the active tool (filled), the active tab, what is selected and an agent that is working.
- The bottom chips each have a two-colour ring (`--a`, `--b`): the one decorative colour in the interface.
- `--needs`, `--done`, `--danger`, `--warn`, `--ok`, `--info`, `--purple` mean status and link kinds only.
- Colours a person picks for shapes and sticky notes are their content and stay as picked. The saved default ink `#ece8e2` means "the theme's text colour": pass stored colours through `themed()`.
- A group saves one of the eight Regnbåge colours by its light hex and shows the theme's own through `groupColor()` (`src/palette.ts`). A group colour saved before Marin shows as saved.
- Agent marks show in their official colours, a one-colour mark in the theme's black or white. On a primary button a mark takes the button's own black or white, `--on-accent`; Codex is the exception there, since its mark is its own white tile and stays as drawn. The selected tool is not filtered: its Claude mark keeps its orange on the accent fill.
- The document sheet (`.paper`) is white paper in both themes, so an author mark on the document card takes its light form in both themes: a one-colour mark is black, a coloured mark keeps its colours.

## Surfaces

- `--glass` with `backdrop-filter: var(--blur)` and `box-shadow: var(--rim), …`: pills, capsules and bars that float over the board, except the command bar, which takes the panel gradient (#9). No solid borders on glass: the rim draws the edge.
- `--popover` with the same blur and rim: menus, sheets, tooltips.
- `--panel`: cards on the board. Nodes are never translucent, so what sits under them cannot bleed through their text.
- `--shadow` for what floats above the board, consoles included; `--shadow-sm` for rails and chips.

## Effects

Each effect has one meaning, so it can only appear where that meaning holds (issue #9).

- **Glow: active now.** `--glow` on the selected tool; a soft accent glow (16px at 36 %, upstream's strength) on the command bar's and the orchestrator's orb; `--glow-soft` on the working console card. Nothing else glows: not the send button, tabs, wires, chips, pills, menus or other buttons, and not the small orbs in menus and Mission Map rows.
- **Shadow: floats above the board.** Consoles, the orchestrator, the command bar, the chips, the toolbar and the top bar's pills. The board stays flat.
- **Gradient: the main thing to press.** `--accent` to `--accent-2` on the selected tool, and on the send button once the field holds text; empty, the send button keeps upstream's grey. The orbs are a lit sphere as upstream draws them, in Marin's blues: one radial gradient from a pale highlight through `--accent-2` and `--accent` to a deep blue rim, with no hard edges. Its soft form is a faint top-down tint on group frames, console heads and the command bar. Never a gradient on the board.
- **Pulse: work in progress.** The working card's glow breathes over 2.6s and the Working dot blinks. The orbs stand still, as upstream's do: turning a lit sphere would move its light. **Under `prefers-reduced-motion: reduce` the working card's breathing and the status pill's Working dot stop**; the working card keeps a still glow.

## Type

- The system font (`--font`, San Francisco on a Mac). The base size is 13px; the scale is 11 to 13 for controls and text, 15 for sheet titles, 20 and 32 for the two empty and home headlines. Sentence case always.
- `--mono` (JetBrains Mono) is for terminals, code, diffs, paths and commit hashes. Numbers elsewhere use `font-variant-numeric: tabular-nums`.

## Shape and controls

- Radii: 9 to 12 for controls and pills that hold several, 16 for cards and menus, 20 for sheets and the command bar. Full round for chips, tools, round buttons and ring petals.
- Control height 28 to 36. Lucide icons at stroke 1.6.
- Selected in a segmented control is a neutral raised segment (`--seg-on`), not the accent.
- Every control with no visible word has a `title`, which `Tips` shows as a tooltip. Say what pressing it does, not what it is called.
- Console actions appear on hover or keyboard focus. Status is always visible, as a dot and a plain word.
- A small menu that belongs to a node (size, context) opens as a `Popover` on the page, never inside the node: it is not clipped and keeps its size at any zoom. Esc or a click away closes it.
- A write box is never disabled. What cannot be delivered yet waits, says so, and can be taken back.

## Motion

It should feel like one continuous material answering the hand. Everything uses `--spring` and only transform and opacity for movement: presses shrink a touch, menus and sheets rise into place in 0.2 to 0.3s, new consoles settle in. Marin's pulse is the exception (the working card's glow breathes). Reduced motion stops them and the status pill's Working dot.

The moment that earns attention is dropping a terminal on another: the target tints and says what will happen, then both glide into a frame that settles around them. Exact sizes glide the same way, and a terminal refits only when the size has settled, so the CLI does not repaint on every frame. Day and night cross-fade with a view transition.

An element that animates its opacity must not hold the end state (`both`) if something inside it uses `backdrop-filter`: while held, the inner glass has nothing behind it to blur.
