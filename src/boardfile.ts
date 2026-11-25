// The board file's schema: pure, no store, no DOM, so it runs under plain `node --test` too.
import type { Preset, Project, Settings } from './store'

export const BOARD_VERSION = 1

export type Board = { projects: Project[]; active: string | null; settings: Settings; presets: Preset[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function migrate(saved: unknown, initial: Board): Board {
  // Version 1 is vibeboard 1.0.0's shape, so a file without `version` needs no step; a later version adds its step here.
  const file = isObject(saved) ? saved : {}
  return {
    projects: Array.isArray(file.projects) ? file.projects : initial.projects,
    active: typeof file.active === 'string' || file.active === null ? file.active : initial.active,
    settings: isObject(file.settings) ? { ...initial.settings, ...file.settings } : { ...initial.settings },
    presets: Array.isArray(file.presets) ? file.presets : initial.presets,
  }
}
