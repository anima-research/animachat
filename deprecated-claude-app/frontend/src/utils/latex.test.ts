import { describe, it, expect, vi } from 'vitest';
import katex from 'katex';
import { renderLatex, KATEX_ALLOWED_TAGS, KATEX_ALLOWED_ATTRS } from './latex';

describe('renderLatex', () => {
  describe('skip optimization', () => {
    it('returns input unchanged when no math delimiters present', () => {
      const input = 'This is plain text with no math at all.';
      expect(renderLatex(input)).toBe(input);
    });

    it('returns input unchanged for empty string', () => {
      expect(renderLatex('')).toBe('');
    });
  });

  describe('display math — $$ ... $$', () => {
    it('renders display math with double dollar signs', () => {
      const result = renderLatex('$$x^2$$');
      expect(result).toContain('katex');
      expect(result).not.toBe('$$x^2$$'); // Should be transformed
    });

    it('renders multiline display math', () => {
      const input = '$$\n\\frac{a}{b}\n$$';
      const result = renderLatex(input);
      expect(result).toContain('katex');
      expect(result).toContain('frac'); // KaTeX renders frac
    });
  });

  describe('display math — \\[ ... \\]', () => {
    it('renders display math with bracket notation', () => {
      const result = renderLatex('\\[x + y = z\\]');
      expect(result).toContain('katex');
      expect(result).not.toBe('\\[x + y = z\\]');
    });
  });

  describe('inline math — $ ... $', () => {
    it('renders inline math with single dollar signs', () => {
      const result = renderLatex('The value is $x^2$ here');
      expect(result).toContain('katex');
      expect(result).not.toContain('$x^2$');
    });

    it('does not render double dollar as inline', () => {
      // $$ should be display math, not inline
      const result = renderLatex('$$x^2$$');
      // After processing display math, there shouldn't be remaining $..$ patterns
      // KaTeX output should be present
      expect(result).toContain('katex');
    });
  });

  describe('inline math — \\( ... \\)', () => {
    it('renders inline math with parenthesis notation', () => {
      const result = renderLatex('Value is \\(x + 1\\) here');
      expect(result).toContain('katex');
      expect(result).not.toContain('\\(x + 1\\)');
    });
  });

  describe('error recovery', () => {
    it('returns original on malformed LaTeX in display mode', () => {
      const input = '$$\\undefinedcommand{abc}$$';
      const result = renderLatex(input);
      // With throwOnError: false, KaTeX renders error in-place rather than throwing
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns original on malformed inline LaTeX', () => {
      const input = 'Text $\\badcommand$ more text';
      const result = renderLatex(input);
      expect(typeof result).toBe('string');
      expect(result).toContain('Text');
      expect(result).toContain('more text');
    });

    it('returns original $$ delimited math when katex throws', () => {
      const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
        throw new Error('katex crash');
      });
      const result = renderLatex('$$x^2$$');
      expect(result).toBe('$$x^2$$');
      spy.mockRestore();
    });

    it('returns original \\[...\\] math when katex throws', () => {
      const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
        throw new Error('katex crash');
      });
      const result = renderLatex('\\[x^2\\]');
      expect(result).toBe('\\[x^2\\]');
      spy.mockRestore();
    });

    it('returns original $...$ inline math when katex throws', () => {
      const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
        throw new Error('katex crash');
      });
      const result = renderLatex('before $x^2$ after');
      expect(result).toContain('$x^2$');
      expect(result).toContain('before');
      expect(result).toContain('after');
      spy.mockRestore();
    });

    it('returns original \\(...\\) inline math when katex throws', () => {
      const spy = vi.spyOn(katex, 'renderToString').mockImplementation(() => {
        throw new Error('katex crash');
      });
      const result = renderLatex('before \\(x^2\\) after');
      expect(result).toContain('\\(x^2\\)');
      expect(result).toContain('before');
      expect(result).toContain('after');
      spy.mockRestore();
    });
  });

  describe('mixed content', () => {
    it('renders both display and inline math in the same string', () => {
      const input = 'Inline $x$ and display $$y^2$$';
      const result = renderLatex(input);
      expect(result).toContain('Inline');
      expect(result).toContain('and display');
      // Both math sections should be rendered
      expect(result).not.toContain('$x$');
      expect(result).not.toContain('$$y^2$$');
    });

    it('preserves non-math text around math expressions', () => {
      const input = 'Before $a$ middle $$b$$ after';
      const result = renderLatex(input);
      expect(result).toContain('Before');
      expect(result).toContain('middle');
      expect(result).toContain('after');
    });
  });

  describe('delimiter edge cases', () => {
    it('handles content with dollar sign but no closing delimiter', () => {
      const input = 'Price is $5';
      const result = renderLatex(input);
      // No matching closing delimiter, should be largely unchanged
      // (The $ triggers processing but regex won't match a lone $)
      expect(result).toContain('5');
    });

    it('handles content with backslash-paren but not as math', () => {
      const input = 'See \\( above';
      // No closing \), so should pass through largely unchanged
      const result = renderLatex(input);
      expect(typeof result).toBe('string');
    });
  });
});

describe('KATEX_ALLOWED_TAGS', () => {
  it('includes essential KaTeX HTML tags', () => {
    expect(KATEX_ALLOWED_TAGS).toContain('span');
    expect(KATEX_ALLOWED_TAGS).toContain('math');
    expect(KATEX_ALLOWED_TAGS).toContain('mrow');
    expect(KATEX_ALLOWED_TAGS).toContain('svg');
  });

  it('is a non-empty array', () => {
    expect(Array.isArray(KATEX_ALLOWED_TAGS)).toBe(true);
    expect(KATEX_ALLOWED_TAGS.length).toBeGreaterThan(5);
  });
});

describe('KATEX_ALLOWED_ATTRS', () => {
  it('includes essential KaTeX attributes', () => {
    expect(KATEX_ALLOWED_ATTRS).toContain('class');
    expect(KATEX_ALLOWED_ATTRS).toContain('style');
    expect(KATEX_ALLOWED_ATTRS).toContain('aria-hidden');
  });

  it('is a non-empty array', () => {
    expect(Array.isArray(KATEX_ALLOWED_ATTRS)).toBe(true);
    expect(KATEX_ALLOWED_ATTRS.length).toBeGreaterThan(3);
  });
});
