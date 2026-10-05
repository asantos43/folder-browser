/** The one-file build of js-beautify (it has no types of its own for this path). */
declare module 'js-beautify/js/lib/beautifier.js' {
  const beautifier: {
    js: (source: string, options?: Record<string, unknown>) => string
    css: (source: string, options?: Record<string, unknown>) => string
    html: (source: string, options?: Record<string, unknown>) => string
  }
  export default beautifier
}
