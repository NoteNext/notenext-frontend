import DOMPurify from 'dompurify';

/**
 * Checks if the content contains HTML tags (e.g. <p dir="ltr">, <div>, <h1>, etc.).
 */
export function isHtmlContent(text: string): boolean {
  if (!text) return false;
  // Match common HTML tags like <p>, <p dir="...">, <div>, <h1>-<h6>, <span>, <ul>, <ol>, <li>, <a>, <br>, <table>, etc.
  const htmlRegex = /<\/?(p|div|h[1-6]|span|ul|ol|li|a|b|i|strong|em|code|pre|blockquote|table|tr|td|th|br|hr|html|body|header|section|article|main)\b[^>]*>/i;
  return htmlRegex.test(text);
}

/**
 * Checks if the content resembles Markdown syntax.
 */
export function isMarkdownContent(text: string, language?: string): boolean {
  if (language === 'markdown' || language === 'md') return true;
  if (!text) return false;
  const mdPatterns = [
    /^#{1,6}\s+/m,             // Headers # Header
    /^\s*[\*\-\+]\s+/m,        // Unordered lists - item
    /^\s*\d+\.\s+/m,           // Ordered lists 1. item
    /\[.+\]\(.+\)/,            // Links [text](url)
    /`{3}[\s\S]*?`{3}/,        // Code blocks ```
    /\*\*.+\*\*/,              // Bold **text**
    /^\s*>\s+/m,               // Blockquotes > text
  ];
  return mdPatterns.some((pattern) => pattern.test(text));
}

/**
 * Sanitizes HTML content safely, preserving text direction (dir="ltr" / "rtl"), inline styles, and safe markup.
 */
export function sanitizeHtml(htmlString: string): string {
  if (typeof window === 'undefined') {
    return htmlString;
  }
  return DOMPurify.sanitize(htmlString, {
    ADD_ATTR: ['dir', 'style', 'target', 'class', 'align'],
    ALLOWED_TAGS: [
      'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
      'span', 'ul', 'ol', 'li', 'a', 'b', 'i', 'strong', 
      'em', 'code', 'pre', 'blockquote', 'table', 'thead', 
      'tbody', 'tr', 'td', 'th', 'br', 'hr', 'u', 's', 
      'sub', 'sup', 'img', 'mark', 'details', 'summary'
    ],
  });
}

/**
 * Simple Markdown to HTML converter fallback.
 */
export function markdownToHtml(md: string): string {
  if (!md) return '';
  
  let html = md;
  
  // Replace code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`;
  });
  
  // Replace inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Blockquotes
  html = html.replace(/^\s*>\s*(.*$)/gim, '<blockquote>$1</blockquote>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  
  // Line breaks & Paragraphs
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs
    .map((p) => {
      p = p.trim();
      if (!p) return '';
      if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<blockquote') || p.startsWith('<ul') || p.startsWith('<ol')) {
        return p;
      }
      return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');

  return sanitizeHtml(html);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
