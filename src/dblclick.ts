// Whether a double-click on a card focuses it: no DOM, so it runs under plain `node --test` too.

export function focusesOnDoubleClick(target: Pick<Element, 'closest'>, zoom: number): boolean {
  if (target.closest('input, textarea, button, select, [contenteditable]:not([contenteditable="false"])')) return false
  // 100 % as the zoom label rounds it: there xterm's own selection lines up, so the terminal keeps its double-click.
  return !(target.closest('.xterm') && Math.round(zoom * 100) === 100)
}
