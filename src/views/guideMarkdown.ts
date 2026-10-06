import MarkdownIt from 'markdown-it'

/**
 * The user guide as a page. It is a file of ours (docs/USER-GUIDE*.md, copied into the build), so it may do what a Markdown file of a snapshot may not, within limits:
 * a picture is shown when it is one of the guide's own (`images/<name>.png`, read from the interface's own scheme), a link to another part of the guide (`#heading`)
 * scrolls, a link to the web opens in the browser, and any other link (a file of the repository) is only text. Raw HTML is still off.
 */
const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false })

const WEB = /^(https?:|mailto:)/i
const GUIDE_IMAGE = /^images\/[\w.-]+\.png$/

/** The address of a heading the way GitHub makes it (`Tables (CSV and TSV)` is `tables-csv-and-tsv`), which is what the guide's own links use. */
export function slugOf(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]
  const alt = md.utils.escapeHtml(String(token.content))
  const src = String(token.attrGet('src') ?? '')
  return GUIDE_IMAGE.test(src) ? `<img src="./guide/${md.utils.escapeHtml(src)}" alt="${alt}" loading="lazy">` : `<span class="md-image">${alt || '·'}</span>`
}
md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index]
  const href = String(token.attrGet('href') ?? '')
  token.attrs = WEB.test(href) || /^#[\p{L}\p{N}_-]+$/u.test(href) ? [['href', href]] : []
  return self.renderToken(tokens, index, options)
}
md.renderer.rules.heading_open = (tokens, index, options, _env, self) => {
  const inline = tokens[index + 1]
  tokens[index].attrSet('id', slugOf(inline?.content ?? ''))
  return self.renderToken(tokens, index, options)
}

export function renderGuide(text: string): string {
  return md.render(text)
}
