// One-colour marks are drawn in `currentColor`; their official forms are black or white, so the theme picks.
export const markSvg = (svg: string, theme: 'light' | 'dark'): string => svg.replaceAll('currentColor', theme === 'dark' ? '#ffffff' : '#000000')
