/** A printer (the Codicons have none), drawn with the text colour like them. */
export function PrintIcon({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="1em" height="1em" fill="currentColor" className={className}>
      <path d="M4 1.5h8a.5.5 0 0 1 .5.5v2.5H4V2a.5.5 0 0 1 0-.5zM3.5 2v2.5H2.5A1.5 1.5 0 0 0 1 6v4a1.5 1.5 0 0 0 1.5 1.5h1V14a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5v-2.5h1A1.5 1.5 0 0 0 15 10V6a1.5 1.5 0 0 0-1.5-1.5h-1V2a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 2zM4.5 9.5h7v4h-7v-4zM2.5 5.5h11a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-1V9a.5.5 0 0 0-.5-.5H4a.5.5 0 0 0-.5.5v1.5h-1A.5.5 0 0 1 2 10V6a.5.5 0 0 1 .5-.5zM12 6.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" fillRule="evenodd" />
    </svg>
  )
}
