// Groups save the light hex; src/marin.css shows each theme's own as --group-N (issue #9).
export const GROUP_COLORS = ['#e8483d', '#d98a00', '#0fa596', '#2369e8', '#7a47e6', '#e2428a', '#2fa84a', '#ea6f1e']

export const groupColor = (color: string): string => {
  const i = GROUP_COLORS.indexOf(color)
  return i < 0 ? color : `var(--group-${i})`
}
