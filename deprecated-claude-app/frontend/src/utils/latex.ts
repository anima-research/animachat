import katex from 'katex';

/**
 * Render LaTeX in content.
 * Supports:
 * - Display math: $$ ... $$ or \[ ... \]
 * - Inline math: $ ... $ or \( ... \)
 * 
 * Returns HTML with rendered LaTeX.
 */
export function renderLatex(content: string): string {
  // Skip if no math delimiters are present (optimization)
  if (!content.includes('$') && !content.includes('\\(') && !content.includes('\\[')) {
    return content;
  }
  
  let result = content;
  
  // Common KaTeX options - strict: false suppresses warnings about unknown Unicode chars
  const katexOptions = {
    throwOnError: false,
    strict: false, // Suppress warnings about box-drawing chars, etc.
    output: 'html' as const
  };
  
  // Display math: $$ ... $$ (must be processed before single $)
  result = result.replace(/\$\$([\s\S]*?)\$\$/g, (match, latex) => {
    try {
      return katex.renderToString(latex.trim(), {
        ...katexOptions,
        displayMode: true
      });
    } catch (e) {
      console.warn('LaTeX render error (display):', e);
      return match; // Return original on error
    }
  });
  
  // Display math: \[ ... \]
  result = result.replace(/\\\[([\s\S]*?)\\\]/g, (match, latex) => {
    try {
      return katex.renderToString(latex.trim(), {
        ...katexOptions,
        displayMode: true
      });
    } catch (e) {
      console.warn('LaTeX render error (display):', e);
      return match;
    }
  });
  
  // Inline math: $ ... $ (but not $$ or escaped \$)
  // Use negative lookbehind to avoid matching escaped $ or $$
  result = result.replace(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$/g, (match, latex) => {
    try {
      return katex.renderToString(latex.trim(), {
        ...katexOptions,
        displayMode: false
      });
    } catch (e) {
      console.warn('LaTeX render error (inline):', e);
      return match;
    }
  });
  
  // Inline math: \( ... \)
  result = result.replace(/\\\(([\s\S]*?)\\\)/g, (match, latex) => {
    try {
      return katex.renderToString(latex.trim(), {
        ...katexOptions,
        displayMode: false
      });
    } catch (e) {
      console.warn('LaTeX render error (inline):', e);
      return match;
    }
  });
  
  return result;
}

/**
 * List of tags that KaTeX generates which need to be allowed in DOMPurify
 */
export const KATEX_ALLOWED_TAGS = [
  'span', 'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub',
  'mfrac', 'mover', 'munder', 'munderover', 'msqrt', 'mroot', 'mtable',
  'mtr', 'mtd', 'mtext', 'mspace', 'annotation', 'svg', 'line', 'path'
];

/**
 * List of attributes that KaTeX uses
 */
export const KATEX_ALLOWED_ATTRS = [
  'class', 'style', 'aria-hidden', 'encoding', 'xmlns', 'xlink:href',
  'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width',
  'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2'
];



