import { describe, it, expect } from 'vitest';
import { MODEL_COLORS, getModelColor, getLighterColor } from './modelColors';

describe('MODEL_COLORS', () => {
  it('contains a default fallback color', () => {
    expect(MODEL_COLORS.default).toBe('#9e9e9e');
  });

  it('contains entries for major model families', () => {
    // Spot-check a few well-known models
    expect(MODEL_COLORS['claude-3-opus-20240229']).toBe('#ffc300');
    expect(MODEL_COLORS['claude-3-5-sonnet-20241022']).toBe('#ed098e');
    expect(MODEL_COLORS['gpt-4o']).toBe('#ad1457');
    expect(MODEL_COLORS['gemini-1.5-pro']).toBe('#8bc34a');
    expect(MODEL_COLORS['mistral-large']).toBe('#3f51b5');
  });
});

describe('getModelColor', () => {
  describe('direct model ID match', () => {
    it('returns exact color for known model IDs', () => {
      expect(getModelColor('claude-3-opus-20240229')).toBe('#ffc300');
      expect(getModelColor('gpt-4o')).toBe('#ad1457');
      expect(getModelColor('deepseek-chat')).toBe('#795548');
    });
  });

  describe('undefined/null input', () => {
    it('returns default for undefined', () => {
      expect(getModelColor(undefined)).toBe(MODEL_COLORS.default);
    });

    it('returns default for empty string', () => {
      // Empty string is falsy but not undefined - still falls through to default
      expect(getModelColor('')).toBe(MODEL_COLORS.default);
    });
  });

  describe('pattern matching — Claude Opus variants', () => {
    it('matches opus-4-1 pattern', () => {
      expect(getModelColor('anthropic/claude-opus-4-1-latest')).toBe(
        MODEL_COLORS['claude-opus-4-1-20250805']
      );
    });

    it('matches opus-4 pattern', () => {
      expect(getModelColor('claude-opus-4-20250514')).toBe(
        MODEL_COLORS['claude-opus-4-20250514']
      );
    });

    it('matches generic opus pattern', () => {
      expect(getModelColor('some-opus-variant')).toBe(
        MODEL_COLORS['claude-3-opus-20240229']
      );
    });
  });

  describe('pattern matching — Claude Sonnet variants', () => {
    it('matches sonnet-4-5 / sonnet-4.5 pattern', () => {
      expect(getModelColor('claude-sonnet-4-5-latest')).toBe(
        MODEL_COLORS['claude-sonnet-4-5-20250929']
      );
      expect(getModelColor('Claude Sonnet 4.5')).toBe(
        MODEL_COLORS['claude-sonnet-4-5-20250929']
      );
    });

    it('matches sonnet-4 pattern', () => {
      expect(getModelColor('claude-sonnet-4-20250514')).toBe(
        MODEL_COLORS['claude-sonnet-4-20250514']
      );
    });

    it('matches 3-7-sonnet pattern', () => {
      expect(getModelColor('claude-3-7-sonnet-20250219')).toBe(
        MODEL_COLORS['claude-3-7-sonnet-20250219']
      );
      expect(getModelColor('claude-3.7-sonnet')).toBe(
        MODEL_COLORS['claude-3-7-sonnet-20250219']
      );
    });

    it('matches 3-5-sonnet pattern (maps to 3-5-sonnet-20240620)', () => {
      expect(getModelColor('claude-3-5-sonnet-v2')).toBe(
        MODEL_COLORS['claude-3-5-sonnet-20240620']
      );
    });

    it('matches generic sonnet pattern', () => {
      expect(getModelColor('some-sonnet-model')).toBe(
        MODEL_COLORS['claude-3-sonnet-20240229']
      );
    });
  });

  describe('pattern matching — Claude Haiku variants', () => {
    it('matches 3-5-haiku pattern', () => {
      expect(getModelColor('claude-3-5-haiku-latest')).toBe(
        MODEL_COLORS['claude-3-5-haiku-20241022']
      );
    });

    it('matches generic haiku pattern', () => {
      expect(getModelColor('claude-haiku-v1')).toBe(
        MODEL_COLORS['claude-3-haiku-20240307']
      );
    });
  });

  describe('pattern matching — Claude 2.x', () => {
    it('matches claude-2.1', () => {
      expect(getModelColor('claude-2.1-extended')).toBe(MODEL_COLORS['claude-2.1']);
    });

    it('matches claude-2', () => {
      expect(getModelColor('claude-2-latest')).toBe(MODEL_COLORS['claude-2.0']);
    });

    it('matches instant', () => {
      expect(getModelColor('claude-instant-v2')).toBe(
        MODEL_COLORS['claude-instant-1.2']
      );
    });
  });

  describe('pattern matching — GPT variants', () => {
    it('matches gpt-4-turbo', () => {
      expect(getModelColor('gpt-4-turbo-preview')).toBe(MODEL_COLORS['gpt-4-turbo']);
    });

    it('matches gpt-4o', () => {
      expect(getModelColor('gpt-4o-mini-2024')).toBe(MODEL_COLORS['gpt-4o']);
    });

    it('matches gpt-4', () => {
      expect(getModelColor('openai/gpt-4-0613')).toBe(MODEL_COLORS['gpt-4']);
    });

    it('matches gpt-3.5', () => {
      expect(getModelColor('gpt-3.5-turbo-1106')).toBe(MODEL_COLORS['gpt-3.5-turbo']);
    });
  });

  describe('pattern matching — Llama variants', () => {
    it('matches llama 405b', () => {
      expect(getModelColor('meta-llama-3.1-405b-instruct')).toBe(
        MODEL_COLORS['llama-3.1-405b']
      );
    });

    it('matches llama 70b', () => {
      expect(getModelColor('llama-3.1-70b-chat')).toBe(MODEL_COLORS['llama-3.1-70b']);
    });

    it('matches llama 8b', () => {
      expect(getModelColor('llama-3.1-8b-instruct')).toBe(MODEL_COLORS['llama-3.1-8b']);
    });

    it('matches generic llama', () => {
      expect(getModelColor('meta-llama-generic')).toBe(MODEL_COLORS['llama-3-70b']);
    });
  });

  describe('pattern matching — Gemini variants', () => {
    it('matches gemini 1.5-pro', () => {
      expect(getModelColor('gemini-1.5-pro-latest')).toBe(
        MODEL_COLORS['gemini-1.5-pro']
      );
    });

    it('matches gemini flash', () => {
      expect(getModelColor('gemini-1.5-flash-8b')).toBe(
        MODEL_COLORS['gemini-1.5-flash']
      );
    });

    it('matches generic gemini', () => {
      expect(getModelColor('gemini-2.0-ultra')).toBe(MODEL_COLORS['gemini-1.0-pro']);
    });
  });

  describe('pattern matching — Mistral variants', () => {
    it('matches mistral-large', () => {
      expect(getModelColor('mistral-large-latest')).toBe(MODEL_COLORS['mistral-large']);
    });

    it('matches mistral-medium', () => {
      expect(getModelColor('mistral-medium-2312')).toBe(MODEL_COLORS['mistral-medium']);
    });

    it('matches mixtral', () => {
      expect(getModelColor('mixtral-8x22b')).toBe(MODEL_COLORS['mixtral-8x7b']);
    });

    it('matches generic mistral (falls to small)', () => {
      expect(getModelColor('mistral-tiny')).toBe(MODEL_COLORS['mistral-small']);
    });
  });

  describe('pattern matching — Other models', () => {
    it('matches command-r-plus', () => {
      expect(getModelColor('command-r-plus-v2')).toBe(MODEL_COLORS['command-r-plus']);
    });

    it('matches command-r', () => {
      expect(getModelColor('command-r-latest')).toBe(MODEL_COLORS['command-r']);
    });

    it('matches deepseek', () => {
      expect(getModelColor('deepseek-coder-v2')).toBe(MODEL_COLORS['deepseek-chat']);
    });

    it('matches o1-mini', () => {
      expect(getModelColor('o1-mini-2024')).toBe(MODEL_COLORS['o1-mini']);
    });

    it('matches o1-preview', () => {
      expect(getModelColor('o1-preview-latest')).toBe(MODEL_COLORS['o1-preview']);
    });
  });

  describe('default fallback', () => {
    it('returns default for completely unknown model', () => {
      expect(getModelColor('totally-unknown-model-xyz')).toBe(MODEL_COLORS.default);
    });
  });
});

describe('getLighterColor', () => {
  it('converts hex to rgba with default opacity (0.1)', () => {
    const result = getLighterColor('#ff0000');
    expect(result).toBe('rgba(255, 0, 0, 0.1)');
  });

  it('converts hex to rgba with custom opacity', () => {
    const result = getLighterColor('#00ff00', 0.5);
    expect(result).toBe('rgba(0, 255, 0, 0.5)');
  });

  it('correctly parses complex hex colors', () => {
    const result = getLighterColor('#2196F3', 0.2);
    expect(result).toBe('rgba(33, 150, 243, 0.2)');
  });

  it('handles black color', () => {
    expect(getLighterColor('#000000', 0.3)).toBe('rgba(0, 0, 0, 0.3)');
  });

  it('handles white color', () => {
    expect(getLighterColor('#ffffff', 0.8)).toBe('rgba(255, 255, 255, 0.8)');
  });

  it('handles zero opacity', () => {
    expect(getLighterColor('#ff0000', 0)).toBe('rgba(255, 0, 0, 0)');
  });

  it('handles full opacity', () => {
    expect(getLighterColor('#ff0000', 1)).toBe('rgba(255, 0, 0, 1)');
  });
});
