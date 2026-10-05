/**
 * What can be wrong with a file, as stable codes. The words that tell people (in English and Brazilian Portuguese) live
 * in the interface, keyed by these codes: a refusal always says why in plain words, never "broken file".
 */
export const ISSUE_CODES = [
  // the container (FORMAT.md sections 2, 3 and 5)
  'not-zip',
  'zip64',
  'zip-encrypted',
  'zip-method',
  'first-entry',
  'unsafe-path',
  'path-clash',
  // what the file is (sections 3, 8, 9 and 11)
  'not-wsnp',
  'application',
  'protected',
  'newer-version',
  // the manifest (steps 4 to 8 of the checklist)
  'no-manifest',
  'manifest-json',
  'format',
  'bad-version',
  'field',
  'source-url',
  'file-record',
  'entry-not-listed',
  'file-missing',
  'size-mismatch',
  'page-missing',
  'preview-missing',
  // the integrity pass (reads every file)
  'hash-mismatch',
  'read-error',
  'inline-script',
  'foreign-script',
  'inline-handler',
  'network-reference',
  // a PageKeep ZIP that could not be converted (docs/PAGEKEEP-ZIP.md)
  'convert-no-source',
  'convert-unreadable',
  'convert-too-large',
  'convert-failed',
  // the signature (FORMAT.md section 12)
  'signature-invalid',
] as const

export type IssueCode = (typeof ISSUE_CODES)[number]

export interface Issue {
  code: IssueCode
  /** The entry the issue is about. */
  path?: string
  /** The manifest field the issue is about. */
  field?: string
  /** Something more, for the log (never needed to understand the issue). */
  detail?: string
}

/** Codes that mean "this viewer cannot open the file" but the file itself may be fine: said gently, not as an error. */
export const UNSUPPORTED: readonly IssueCode[] = ['application', 'protected', 'newer-version']
