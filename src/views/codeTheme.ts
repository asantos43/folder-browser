import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { java } from '@codemirror/lang-java'
import { less } from '@codemirror/lang-less'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sass } from '@codemirror/lang-sass'
import { sql } from '@codemirror/lang-sql'
import { clojure } from '@codemirror/legacy-modes/mode/clojure'
import { cmake } from '@codemirror/legacy-modes/mode/cmake'
import { csharp, dart, kotlin, scala } from '@codemirror/legacy-modes/mode/clike'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { erlang } from '@codemirror/legacy-modes/mode/erlang'
import { groovy } from '@codemirror/legacy-modes/mode/groovy'
import { haskell } from '@codemirror/legacy-modes/mode/haskell'
import { julia } from '@codemirror/legacy-modes/mode/julia'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { pascal } from '@codemirror/legacy-modes/mode/pascal'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf'
import { r } from '@codemirror/legacy-modes/mode/r'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { xml } from '@codemirror/lang-xml'
import { closeBrackets } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { Language } from '@core/filekind.ts'
import { findExtension } from '@/find/code.ts'

const v = (name: string) => `var(--wsnp-${name})`

/** The read-only editor in the colours of the theme in use: everything is a CSS variable, so switching theme needs no rebuild. */
const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--vscode-editor-foreground)', backgroundColor: 'var(--vscode-editor-background)', fontSize: 'calc(var(--vscode-editor-font-size) * var(--wsnp-zoom, 1))' },
  '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', lineHeight: 'calc(19px * var(--wsnp-zoom, 1))', overflow: 'auto' },
  '.cm-content': { caretColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'var(--vscode-editor-background)', color: v('line-number'), border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 20px', minWidth: '48px' },
  '.cm-activeLine': { backgroundColor: v('line-highlight') },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: v('line-number-active') },
  // The selection of the theme. CodeMirror's own rule for an editor with the focus (`&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`, a pale lilac #d7d4f0)
  // is more specific than a plain `.cm-selectionBackground`, and it won in the dark theme: pale text on a pale selection. This one is as specific, and has `.cm-editor` besides.
  '&.cm-editor .cm-selectionBackground, &.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection': { backgroundColor: v('selection') },
  '.cm-wsnpMatch': { backgroundColor: v('find-match') },
  '.cm-wsnpMatch-current': { backgroundColor: v('find-current'), outline: '1px solid var(--vscode-focusBorder)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: v('match-bracket'), outline: '1px solid var(--vscode-editorGroup-border)' },
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.definitionKeyword], color: v('syntax-keyword') },
  { tag: [t.controlKeyword, t.moduleKeyword], color: v('syntax-control') },
  { tag: [t.string, t.special(t.string), t.attributeValue], color: v('syntax-string') },
  { tag: [t.number, t.integer, t.float], color: v('syntax-number') },
  { tag: [t.bool, t.null, t.atom, t.constant(t.name)], color: v('syntax-keyword') },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v('syntax-comment'), fontStyle: 'italic' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: v('syntax-property') },
  { tag: [t.variableName, t.name], color: v('syntax-property') },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: v('syntax-function') },
  { tag: [t.typeName, t.className, t.namespace], color: v('syntax-type') },
  { tag: [t.tagName, t.angleBracket], color: v('syntax-tag') },
  { tag: [t.attributeName], color: v('syntax-attribute') },
  { tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator], color: v('syntax-operator') },
  { tag: [t.regexp, t.escape], color: v('syntax-regexp') },
  { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.paren, t.squareBracket], color: v('syntax-punctuation') },
  { tag: [t.processingInstruction, t.meta, t.documentMeta], color: v('syntax-keyword') },
  { tag: [t.standard(t.variableName), t.standard(t.name), t.special(t.variableName), t.labelName], color: v('syntax-function') },
  { tag: [t.heading, t.strong], fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.inserted, color: v('syntax-string') },
  { tag: t.deleted, color: 'var(--vscode-errorForeground)' },
  { tag: t.link, color: 'var(--vscode-textLinkForeground)', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--vscode-errorForeground)' },
])

const languages: Record<Language, () => Extension> = {
  json,
  html,
  css,
  javascript,
  typescript: () => javascript({ typescript: true }),
  jsx: () => javascript({ jsx: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  xml,
  markdown,
  yaml,
  plain: () => [],
  python,
  c: cpp,
  cpp,
  java,
  rust,
  go,
  php,
  sql,
  scss: () => sass(),
  sass: () => sass({ indented: true }),
  less,
  // The languages CodeMirror has no parser of its own for come from its stream modes.
  kotlin: () => StreamLanguage.define(kotlin),
  scala: () => StreamLanguage.define(scala),
  csharp: () => StreamLanguage.define(csharp),
  dart: () => StreamLanguage.define(dart),
  swift: () => StreamLanguage.define(swift),
  ruby: () => StreamLanguage.define(ruby),
  perl: () => StreamLanguage.define(perl),
  lua: () => StreamLanguage.define(lua),
  r: () => StreamLanguage.define(r),
  groovy: () => StreamLanguage.define(groovy),
  haskell: () => StreamLanguage.define(haskell),
  julia: () => StreamLanguage.define(julia),
  clojure: () => StreamLanguage.define(clojure),
  erlang: () => StreamLanguage.define(erlang),
  shell: () => StreamLanguage.define(shell),
  powershell: () => StreamLanguage.define(powerShell),
  toml: () => StreamLanguage.define(toml),
  properties: () => StreamLanguage.define(properties),
  dockerfile: () => StreamLanguage.define(dockerFile),
  cmake: () => StreamLanguage.define(cmake),
  diff: () => StreamLanguage.define(diff),
  protobuf: () => StreamLanguage.define(protobuf),
  pascal: () => StreamLanguage.define(pascal),
}

/** Word wrap can be switched on and off without making the editor again (the scroll stays where it is). */
export const wrapping = new Compartment()

/** The language of an editor can change (the status bar's Select Language Mode) without making it again: the text, the undo history and the place stay. */
export const languageSlot = new Compartment()
/** Where an editor's listener of changes is put when the tab shows it (it is another one each time the tab is shown, so it is not part of the state that is kept). */
export const listenerSlot = new Compartment()
export const languageExtension = (language: Language): Extension => languages[language]()

/** The extensions of an editor of a file in `language`: what the read-only view has, and a caret, a selection, undo, indenting and the usual keys. */
export const editableExtensions = (language: Language, wrap: boolean): Extension[] => [
  wrapping.of(wrap ? EditorView.lineWrapping : []),
  EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
  history(),
  drawSelection(),
  indentOnInput(),
  closeBrackets(),
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  bracketMatching(),
  syntaxHighlighting(highlight),
  theme,
  // The caret is drawn (the read-only view hides it), and the selection is the theme's.
  EditorView.theme({ '.cm-content': { caretColor: 'var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground))' }, '.cm-cursor': { borderLeftColor: 'var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground))' } }),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  findExtension,
  languageSlot.of(languageExtension(language)),
  listenerSlot.of([]),
]

/** The extensions of a read-only view of a file in `language`. */
export const readOnlyExtensions = (language: Language, wrap: boolean): Extension[] => [
  wrapping.of(wrap ? EditorView.lineWrapping : []),
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  EditorView.contentAttributes.of({ tabindex: '0' }),
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  bracketMatching(),
  syntaxHighlighting(highlight),
  theme,
  findExtension,
  languages[language](),
]
