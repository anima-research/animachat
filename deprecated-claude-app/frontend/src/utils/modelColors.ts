// Model color definitions
export const MODEL_COLORS: Record<string, string> = {
  // Anthropic Claude models - Distinct colors
  'claude-3-5-sonnet-20241022': '#1976d2',  // Classic blue (flagship)
  'claude-3-5-haiku-20241022': '#00897b',   // Teal (fast & light)
  'claude-3-opus-20240229': '#7b1fa2',      // Deep purple (most capable)
  'claude-3-sonnet-20240229': '#0277bd',    // Ocean blue (balanced)
  'claude-3-haiku-20240307': '#43a047',     // Green (efficient)
  
  // OpenAI GPT models - Green shades
  'gpt-4o': '#2e7d32',                      // Forest green
  'gpt-4o-mini': '#43a047',                 // Medium green
  'gpt-4-turbo': '#1b5e20',                 // Deep green
  'gpt-4': '#388e3c',                       // Standard green
  'gpt-3.5-turbo': '#66bb6a',              // Light green
  'o1-preview': '#00695c',                  // Teal green
  'o1-mini': '#00897b',                     // Light teal
  
  // Google models - Orange/Red shades
  'gemini-1.5-pro': '#d84315',              // Deep orange
  'gemini-1.5-flash': '#ff6f00',            // Bright orange
  'gemini-1.0-pro': '#ef6c00',              // Medium orange
  
  // Meta Llama models - Purple shades
  'llama-3.1-405b': '#6a1b9a',              // Deep purple
  'llama-3.1-70b': '#7b1fa2',               // Medium purple
  'llama-3.1-8b': '#8e24aa',                // Light purple
  'llama-3-70b': '#9c27b0',                 // Standard purple
  'llama-3-8b': '#ab47bc',                  // Lighter purple
  
  // Mistral models - Red shades
  'mistral-large': '#c62828',               // Deep red
  'mistral-medium': '#d32f2f',              // Medium red
  'mistral-small': '#e53935',               // Light red
  'mixtral-8x7b': '#ef5350',                // Soft red
  
  // Other models - Various colors
  'deepseek-chat': '#5d4037',               // Brown
  'command-r-plus': '#00838f',              // Cyan
  'command-r': '#0097a7',                   // Light cyan
  
  // Default fallback color
  'default': '#757575'                      // Grey
};

// Get color for a model, with fallback logic
export function getModelColor(model: string | undefined): string {
  if (!model) return MODEL_COLORS.default;
  
  // Direct match
  if (MODEL_COLORS[model]) {
    return MODEL_COLORS[model];
  }
  
  // Try to match by prefix for variants
  const modelLower = model.toLowerCase();
  
  // Claude variants
  if (modelLower.includes('claude')) {
    if (modelLower.includes('opus')) return MODEL_COLORS['claude-3-opus-20240229'];
    if (modelLower.includes('3-5-sonnet') || modelLower.includes('3.5-sonnet')) return MODEL_COLORS['claude-3-5-sonnet-20241022'];
    if (modelLower.includes('3-5-haiku') || modelLower.includes('3.5-haiku')) return MODEL_COLORS['claude-3-5-haiku-20241022'];
    if (modelLower.includes('sonnet')) return MODEL_COLORS['claude-3-sonnet-20240229'];
    if (modelLower.includes('haiku')) return MODEL_COLORS['claude-3-haiku-20240307'];
    return MODEL_COLORS['claude-3-5-sonnet-20241022']; // Default Claude color
  }
  
  // GPT variants
  if (modelLower.includes('gpt')) {
    if (modelLower.includes('4o')) return MODEL_COLORS['gpt-4o'];
    if (modelLower.includes('4')) return MODEL_COLORS['gpt-4'];
    if (modelLower.includes('3.5')) return MODEL_COLORS['gpt-3.5-turbo'];
    return MODEL_COLORS['gpt-4']; // Default GPT color
  }
  
  // Gemini variants
  if (modelLower.includes('gemini')) {
    if (modelLower.includes('1.5-pro')) return MODEL_COLORS['gemini-1.5-pro'];
    if (modelLower.includes('flash')) return MODEL_COLORS['gemini-1.5-flash'];
    return MODEL_COLORS['gemini-1.5-pro']; // Default Gemini color
  }
  
  // Llama variants
  if (modelLower.includes('llama')) {
    if (modelLower.includes('405')) return MODEL_COLORS['llama-3.1-405b'];
    if (modelLower.includes('70')) return MODEL_COLORS['llama-3.1-70b'];
    if (modelLower.includes('8b')) return MODEL_COLORS['llama-3.1-8b'];
    return MODEL_COLORS['llama-3-70b']; // Default Llama color
  }
  
  // Mistral variants
  if (modelLower.includes('mistral') || modelLower.includes('mixtral')) {
    if (modelLower.includes('large')) return MODEL_COLORS['mistral-large'];
    if (modelLower.includes('medium')) return MODEL_COLORS['mistral-medium'];
    if (modelLower.includes('mixtral')) return MODEL_COLORS['mixtral-8x7b'];
    return MODEL_COLORS['mistral-small']; // Default Mistral color
  }
  
  // Command variants
  if (modelLower.includes('command')) {
    if (modelLower.includes('plus')) return MODEL_COLORS['command-r-plus'];
    return MODEL_COLORS['command-r'];
  }
  
  // DeepSeek
  if (modelLower.includes('deepseek')) {
    return MODEL_COLORS['deepseek-chat'];
  }
  
  // O1 variants
  if (modelLower.includes('o1')) {
    if (modelLower.includes('mini')) return MODEL_COLORS['o1-mini'];
    return MODEL_COLORS['o1-preview'];
  }
  
  // Default fallback
  return MODEL_COLORS.default;
}

// Get a lighter variant of a color for backgrounds
export function getLighterColor(color: string, opacity: number = 0.1): string {
  // Convert hex to rgba with opacity
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
