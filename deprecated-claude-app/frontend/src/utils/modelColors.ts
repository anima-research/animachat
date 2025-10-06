// Model color definitions
export const MODEL_COLORS: Record<string, string> = {
  // Claude Opus models
  'claude-opus-4-1-20250805': '#e07102',      // Deep orange
  'claude-opus-4-20250514': '#00e5ff',        // Bright cyan
  'claude-3-opus-20240229': '#ffc300',        // Golden yellow
  
  // Claude Sonnet models
  'claude-sonnet-4-5-20250929': '#af8c8eff',
  'claude-sonnet-4-20250514': '#86a3b0',      // Light sky blue
  'claude-3-7-sonnet-20250219': '#00b0ff',    // Vivid light blue
  'claude-3-5-sonnet-20241022': '#ed098e',    // Hot pink/magenta
  'claude-3-5-sonnet-20240620': '#146fff',    // Vivid blue
  'claude-3-sonnet-20240229': '#f44336',      // Bright red
  
  // Claude Haiku models - Bright green
  'claude-3-5-haiku-20241022': '#4caf50',     // Bright green
  'claude-3-haiku-20240307': '#66bb6a',       // Light green
  
  // Claude 2.x and Instant models - Orange shades
  'claude-2.1': '#ff9800',                    // Bright orange
  'claude-2.0': '#ffa726',                    // Light orange
  'claude-instant-1.2': '#ffb74d',            // Lighter orange
  
  // OpenAI GPT models - Pink/Magenta shades (distinct from Claude)
  'gpt-4-turbo': '#e91e63',                   // Pink
  'gpt-4o': '#ad1457',                        // Deep pink
  'gpt-4o-mini': '#ec407a',                   // Light pink
  'gpt-4': '#c2185b',                         // Magenta
  'gpt-3.5-turbo': '#f48fb1',                 // Soft pink
  
  // Meta Llama models - Amber/Brown shades
  'llama-3.1-405b': '#ff6f00',                // Dark amber
  'llama-3.1-70b': '#ff8f00',                 // Amber
  'llama-3.1-8b': '#ffa000',                  // Light amber
  'llama-3-70b': '#ffb300',                   // Golden amber
  'llama-3-8b': '#ffc400',                    // Light golden amber
  
  // Google Gemini models - Lime green
  'gemini-1.5-pro': '#8bc34a',                // Lime
  'gemini-1.5-flash': '#9ccc65',              // Light lime
  'gemini-1.0-pro': '#aed581',                // Lighter lime
  
  // Mistral models - Indigo (distinct from purple)
  'mistral-large': '#3f51b5',                 // Indigo
  'mistral-medium': '#5c6bc0',                // Light indigo
  'mistral-small': '#7986cb',                 // Lighter indigo
  'mixtral-8x7b': '#9fa8da',                  // Very light indigo
  
  // Other models
  'deepseek-chat': '#795548',                 // Brown
  'command-r-plus': '#009688',                // Teal (different from Claude)
  'command-r': '#26a69a',                     // Light teal
  'o1-preview': '#607d8b',                    // Blue grey
  'o1-mini': '#78909c',                       // Light blue grey
  
  // Default fallback color
  'default': '#9e9e9e'                        // Light grey
};

// Get color for a model, with fallback logic
export function getModelColor(model: string | undefined): string {
  if (!model) return MODEL_COLORS.default;
  
  // Direct match - check for exact model ID
  if (MODEL_COLORS[model]) {
    return MODEL_COLORS[model];
  }
  
  // Try to match by model name patterns
  const modelLower = model.toLowerCase();
  
  // Claude Opus variants (including Bedrock and OpenRouter)
  if (modelLower.includes('opus-4-1') || modelLower.includes('opus-4.1')) {
    return MODEL_COLORS['claude-opus-4-1-20250805'];
  }
  if (modelLower.includes('opus-4') || modelLower.includes('opus 4')) {
    return MODEL_COLORS['claude-opus-4-20250514'];
  }
  if (modelLower.includes('opus')) {
    return MODEL_COLORS['claude-3-opus-20240229'];
  }
  
  // Claude Sonnet variants
  if (modelLower.includes('sonnet-4-5') || modelLower.includes('sonnet-4.5') || modelLower.includes('sonnet 4.5')) {
    return MODEL_COLORS['claude-sonnet-4-5-20250929'];
  }
  if (modelLower.includes('sonnet-4') || modelLower.includes('sonnet 4')) {
    return MODEL_COLORS['claude-sonnet-4-20250514'];
  }
  if (modelLower.includes('3-7-sonnet') || modelLower.includes('3.7-sonnet') || modelLower.includes('sonnet-3.7') || modelLower.includes('sonnet 3.7')) {
    return MODEL_COLORS['claude-3-7-sonnet-20250219'];
  }
  if (modelLower.includes('3-6-sonnet') || modelLower.includes('3.6-sonnet') || modelLower.includes('sonnet-3.6') || modelLower.includes('sonnet 3.6')) {
    return MODEL_COLORS['claude-3-5-sonnet-20241022'];
  }
  if (modelLower.includes('3-5-sonnet') || modelLower.includes('3.5-sonnet') || modelLower.includes('sonnet-3.5') || modelLower.includes('sonnet 3.5')) {
    return MODEL_COLORS['claude-3-5-sonnet-20240620'];
  }
  if (modelLower.includes('sonnet')) {
    return MODEL_COLORS['claude-3-sonnet-20240229'];
  }
  
  // Claude Haiku variants
  if (modelLower.includes('3-5-haiku') || modelLower.includes('3.5-haiku') || modelLower.includes('haiku-3.5') || modelLower.includes('haiku 3.5')) {
    return MODEL_COLORS['claude-3-5-haiku-20241022'];
  }
  if (modelLower.includes('haiku')) {
    return MODEL_COLORS['claude-3-haiku-20240307'];
  }
  
  // Claude 2.x models
  if (modelLower.includes('claude-2.1') || modelLower.includes('claude 2.1')) {
    return MODEL_COLORS['claude-2.1'];
  }
  if (modelLower.includes('claude-2') || modelLower.includes('claude 2')) {
    return MODEL_COLORS['claude-2.0'];
  }
  if (modelLower.includes('instant')) {
    return MODEL_COLORS['claude-instant-1.2'];
  }
  
  // GPT variants
  if (modelLower.includes('gpt-4-turbo') || modelLower.includes('gpt-4 turbo')) {
    return MODEL_COLORS['gpt-4-turbo'];
  }
  if (modelLower.includes('gpt-4o')) {
    return MODEL_COLORS['gpt-4o'];
  }
  if (modelLower.includes('gpt-4')) {
    return MODEL_COLORS['gpt-4'];
  }
  if (modelLower.includes('gpt-3.5')) {
    return MODEL_COLORS['gpt-3.5-turbo'];
  }
  
  // Llama variants
  if (modelLower.includes('llama') && modelLower.includes('405')) {
    return MODEL_COLORS['llama-3.1-405b'];
  }
  if (modelLower.includes('llama') && modelLower.includes('70')) {
    return MODEL_COLORS['llama-3.1-70b'];
  }
  if (modelLower.includes('llama') && modelLower.includes('8b')) {
    return MODEL_COLORS['llama-3.1-8b'];
  }
  if (modelLower.includes('llama')) {
    return MODEL_COLORS['llama-3-70b'];
  }
  
  // Gemini variants
  if (modelLower.includes('gemini') && modelLower.includes('1.5-pro')) {
    return MODEL_COLORS['gemini-1.5-pro'];
  }
  if (modelLower.includes('gemini') && modelLower.includes('flash')) {
    return MODEL_COLORS['gemini-1.5-flash'];
  }
  if (modelLower.includes('gemini')) {
    return MODEL_COLORS['gemini-1.0-pro'];
  }
  
  // Mistral variants
  if (modelLower.includes('mistral') && modelLower.includes('large')) {
    return MODEL_COLORS['mistral-large'];
  }
  if (modelLower.includes('mistral') && modelLower.includes('medium')) {
    return MODEL_COLORS['mistral-medium'];
  }
  if (modelLower.includes('mixtral')) {
    return MODEL_COLORS['mixtral-8x7b'];
  }
  if (modelLower.includes('mistral')) {
    return MODEL_COLORS['mistral-small'];
  }
  
  // Command variants
  if (modelLower.includes('command') && modelLower.includes('plus')) {
    return MODEL_COLORS['command-r-plus'];
  }
  if (modelLower.includes('command')) {
    return MODEL_COLORS['command-r'];
  }
  
  // DeepSeek
  if (modelLower.includes('deepseek')) {
    return MODEL_COLORS['deepseek-chat'];
  }
  
  // O1 variants
  if (modelLower.includes('o1') && modelLower.includes('mini')) {
    return MODEL_COLORS['o1-mini'];
  }
  if (modelLower.includes('o1')) {
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