/**
 * Whether a file or folder is hidden: its name starts with a dot (the convention of Linux and macOS, and of the tools that make such files).
 * The one filter for disk and ZIP entries alike. (The hidden attribute of Windows is not read yet.)
 */
export const isHidden = (name: string): boolean => name.length > 1 && name.startsWith('.') && name !== '..'
