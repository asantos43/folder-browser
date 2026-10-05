// @vitest-environment happy-dom
import type { Language } from '@core/filekind.ts'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeView } from './CodeView.tsx'

afterEach(cleanup)

// A line of each language that has more than one kind of token, so a language that is wired gives coloured spans and one that is not gives none.
const SAMPLES: Record<Exclude<Language, 'plain'>, string> = {
  json: '{"name": "harbor", "items": [1, 2, true, null]}',
  html: '<!doctype html><div class="a" id="b">text <b>bold</b></div>',
  css: '.card > h2 { color: #0a7; margin: 0 }',
  javascript: 'const add = (a, b) => { return a + b } // add',
  typescript: 'interface Item { id: number } const x: Item = { id: 1 }',
  jsx: 'const el = <div className="a">hello</div>',
  tsx: 'const el: JSX.Element = <div className="a">{1}</div>',
  xml: '<svg width="40"><circle cx="20" r="18"/></svg>',
  markdown: '# Title\n\n* one\n* `code`\n',
  yaml: 'name: harbor\nitems:\n  - id: 1\n',
  python: 'def add(a, b):\n    return a + b  # add\n',
  c: '#include <stdio.h>\nint main(void) { printf("hi"); return 0; }',
  cpp: 'class Boat { public: int n = 3; }; // boat',
  java: 'public class Boat { private int n = 3; }',
  kotlin: 'fun add(a: Int, b: Int): Int { return a + b } // add',
  scala: 'object Boat { def add(a: Int, b: Int) = a + b } // add',
  csharp: 'public class Boat { private int n = 3; } // boat',
  dart: 'void main() { var n = 3; print("hi $n"); } // main',
  rust: 'fn add(a: i32, b: i32) -> i32 { a + b } // add',
  go: 'func add(a int, b int) int { return a + b } // add',
  swift: 'func add(a: Int, b: Int) -> Int { return a + b } // add',
  php: '<?php function add($a, $b) { return $a + $b; } // add',
  ruby: 'def add(a, b)\n  a + b # add\nend\n',
  perl: 'my $n = 3; print "hi $n\n"; # perl',
  lua: 'local function add(a, b) return a + b end -- add',
  r: 'add <- function(a, b) { a + b } # add',
  groovy: 'def add(a, b) { return a + b } // add',
  haskell: 'add :: Int -> Int -> Int\nadd a b = a + b -- add\n',
  julia: 'function add(a, b) return a + b end # add',
  clojure: '(defn add [a b] (+ a b)) ; add',
  erlang: 'add(A, B) -> A + B. % add',
  shell: 'if [ -f "$FILE" ]; then echo "found $FILE"; fi # check',
  powershell: 'function Add-Two { param($a) return $a + 2 } # add',
  sql: "SELECT name, COUNT(*) FROM boats WHERE open = 1 GROUP BY name; -- boats",
  toml: '[package]\nname = "harbor"\nversion = "1.0"\n',
  properties: '# comment\nname=harbor\nopen=true\n',
  dockerfile: 'FROM node:24\nRUN npm ci # install\n',
  cmake: 'cmake_minimum_required(VERSION 3.20)\nproject(harbor) # name\n',
  diff: '--- a/boat.txt\n+++ b/boat.txt\n@@ -1 +1 @@\n-old\n+new\n',
  protobuf: 'message Boat { string name = 1; int32 n = 2; } // boat',
  scss: '$c: #0a7; .card { h2 { color: $c; } } // card',
  sass: '$c: #0a7\n.card\n  color: $c\n',
  less: '@c: #0a7; .card { h2 { color: @c; } } // card',
  pascal: 'program Harbor;\nvar n: Integer;\nbegin n := 3; { boat } end.\n',
}

describe('CodeView: the languages it knows are coloured', () => {
  for (const [language, sample] of Object.entries(SAMPLES) as [Exclude<Language, 'plain'>, string][]) {
    it(`${language}`, async () => {
      render(<CodeView text={sample} language={language} wrap={false} />)
      // (The editor colours what it has parsed, and a slow machine parses a little at a time.)
      await waitFor(() => expect(document.querySelectorAll('.cm-line span').length, `${language} has coloured tokens`).toBeGreaterThan(1))
      expect(document.querySelector('.cm-content')?.textContent).toBe(sample.replace(/\n$/, '').replace(/\n/g, ''))
    })
  }

  it('does not colour plain text', () => {
    render(<CodeView text={'const a = 1 // not code'} language="plain" wrap={false} />)
    expect(document.querySelectorAll('.cm-line span').length).toBe(0)
  })
  it('is read-only, and selectable', () => {
    render(<CodeView text="x" language="plain" wrap={false} />)
    expect(document.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false')
  })
  it('changes its text and its wrapping without being made again', () => {
    const { rerender } = render(<CodeView text="one" language="plain" wrap={false} />)
    const editor = document.querySelector('.cm-editor')
    rerender(<CodeView text="two" language="plain" wrap />)
    expect(document.querySelector('.cm-editor')).toBe(editor)
    expect(document.querySelector('.cm-content')?.textContent).toBe('two')
    expect(document.querySelector('.cm-lineWrapping')).not.toBeNull()
  })
})
