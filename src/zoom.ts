// Pure text-to-zoom logic for the board's zoom pill: no DOM, so it runs under plain `node --test` too.

export const digits = (text: string): string => text.replace(/\D/g, '')

export function zoomTarget(text: string, opened: number): number | null {
  const typed = digits(text)
  if (!typed) return null
  // 8 and 250 match minZoom/maxZoom on the board's <ReactFlow>, as percentages.
  const percent = Math.min(250, Math.max(8, Number(typed)))
  return percent === opened ? null : percent
}
