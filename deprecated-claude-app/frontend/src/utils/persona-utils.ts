import type { Persona } from '@deprecated-claude/shared';

/**
 * Color palette for persona avatars and UI elements.
 * Uses Vuetify color names for consistent theming.
 */
export const PERSONA_COLORS = [
  'primary', 'secondary', 'success', 'warning', 'info', 
  'error', 'purple', 'teal', 'orange', 'cyan'
] as const;

/**
 * Get a deterministic color for a persona based on its ID.
 * The same persona will always get the same color.
 */
export function getPersonaColor(persona: Persona | null | undefined): string {
  if (!persona?.id) return 'primary';
  const hash = persona.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return PERSONA_COLORS[hash % PERSONA_COLORS.length];
}

/**
 * Filter out archived personas from a list.
 */
export function filterActivePersonas(personas: Persona[]): Persona[] {
  return personas.filter(p => !p.archivedAt);
}

