import MarkdownIt from 'markdown-it'

/**
 * Markdown to HTML for the formatted view. A file of a snapshot is not to be trusted, so: raw HTML in it is shown as text (`html: false`), a link keeps its
 * address only when it is a web address or a mail address (never `javascript:`, `file:` or a path), and a picture is not loaded (nothing leaves the
 * computer, and a path in the snapshot is not one the interface can reach): its description is shown in its place.
 */
const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false })

const SAFE_LINK = /^(https?:|mailto:)/i

md.renderer.rules.image = (tokens, index) => {
  const alt = md.utils.escapeHtml(String(tokens[index].content))
  return `<span class="md-image">${alt || '·'}</span>`
}
md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index]
  const href = String(token.attrGet('href') ?? '')
  token.attrs = SAFE_LINK.test(href) ? [['href', href]] : []
  return self.renderToken(tokens, index, options)
}

export function renderMarkdown(text: string): string {
  return md.render(text)
}
