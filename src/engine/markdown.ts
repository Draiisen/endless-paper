// Tiny safe markdown -> HTML. Supports **bold**, *italic*, `code`, [text](url), and line breaks.
// Escapes HTML first.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(trimmed)) return trimmed;
  return '#';
}

export function renderMarkdown(src: string): string {
  let s = escapeHtml(src);
  // Inline code (do this first to preserve content)
  s = s.replace(/`([^`]+?)`/g, (_m, code) => `<code style="background:rgba(74,144,217,0.15);padding:1px 4px;border-radius:3px;font-family:ui-monospace,monospace;font-size:0.9em">${code}</code>`);
  // Bold
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  // Links
  s = s.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, (_m, text, url) =>
    `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer" style="color:#4a90d9;text-decoration:underline">${text}</a>`);
  // Newlines -> <br>
  s = s.replace(/\n/g, '<br>');
  return s;
}
