// Whether a double-click on a card focuses it: no DOM, so it runs under plain `node --test` too.

export function focusesOnDoubleClick(target: Pick<Element, 'closest'>, zoom: number): boolean {
  if (target.closest('input, textarea, button, select, [contenteditable]:not([contenteditable="false"])')) return false
  // Retain native terminal word selection at displayed 100%; other zooms keep the framing shortcut.
  return !(target.closest('.xterm') && Math.round(zoom * 100) === 100)
}
