import type { EditorView } from '@codemirror/view'
import { FORMATTABLE, type Language } from '@core/filekind.ts'

/** A file bigger than this is shown as it is: laying out megabytes of minified code would freeze the tab. */
export const FORMAT_LIMIT = 2 * 2 ** 20

export const canFormat = (language: Language, size: number): boolean => FORMATTABLE.includes(language) && size <= FORMAT_LIMIT

interface Beautifier {
  js: (source: string, options?: Record<string, unknown>) => string
  css: (source: string, options?: Record<string, unknown>) => string
  html: (source: string, options?: Record<string, unknown>) => string
}

let library: Promise<Beautifier> | undefined
/** js-beautify (MIT), loaded the first time a file is laid out. It is tolerant: a page that is not quite HTML still gets laid out. */
const load = (): Promise<Beautifier> => (library ??= import('js-beautify/js/lib/beautifier.js').then((m) => ((m as { default?: Beautifier }).default ?? (m as unknown as Beautifier))))

const COMMON = { indent_size: 2, indent_char: ' ', end_with_newline: true, preserve_newlines: true, max_preserve_newlines: 2 }

/**
 * The text laid out for reading: one statement, declaration or element to a line, indented. Only the layout changes, never a token (JSON numbers stay as
 * they are: nothing is parsed). What cannot be laid out comes back unchanged.
 */
export async function formatSource(text: string, language: Language): Promise<string> {
  if (!FORMATTABLE.includes(language)) return text
  try {
    const beautify = await load()
    switch (language) {
      case 'json':
      case 'javascript':
        return beautify.js(text, { ...COMMON, brace_style: 'collapse' })
      case 'css':
        return beautify.css(text, { ...COMMON })
      case 'html':
      case 'xml':
        return beautify.html(text, { ...COMMON, wrap_line_length: 0, indent_inner_html: true, extra_liners: [], content_unformatted: ['pre', 'textarea'] })
      default:
        return text
    }
  } catch {
    return text
  }
}

/** Lays the text of an editor out for reading, as an edit (undo brings it back); the caret stays where it was as far as the new text reaches. */
export async function formatEditor(editor: EditorView, language: Language, current: () => EditorView | null = () => editor): Promise<void> {
  const source = editor.state.doc.toString()
  if (!canFormat(language, source.length)) return
  const formatted = await formatSource(source, language)
  const now = current()
  if (formatted === source || !now) return
  const head = Math.min(now.state.selection.main.head, formatted.length)
  now.dispatch({ changes: { from: 0, to: now.state.doc.length, insert: formatted }, selection: { anchor: head }, userEvent: 'input.format' })
  now.focus()
}
