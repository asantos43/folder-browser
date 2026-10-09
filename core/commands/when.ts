export type WhenContext = Record<string, string | boolean>

type Node =
  | { kind: 'key'; key: string }
  | { kind: 'compare'; key: string; operator: '==' | '!='; value: string }
  | { kind: 'not'; value: Node }
  | { kind: 'and' | 'or'; left: Node; right: Node }

class Parser {
  private at = 0
  private readonly input: string
  constructor(input: string) { this.input = input }

  parse(): Node {
    const value = this.or()
    this.space()
    if (this.at !== this.input.length) this.fail('unexpected token')
    return value
  }

  private or(): Node {
    let value = this.and()
    while (this.take('||')) value = { kind: 'or', left: value, right: this.and() }
    return value
  }

  private and(): Node {
    let value = this.unary()
    while (this.take('&&')) value = { kind: 'and', left: value, right: this.unary() }
    return value
  }

  private unary(): Node {
    this.space()
    if (this.take('!')) return { kind: 'not', value: this.unary() }
    if (this.take('(')) {
      const value = this.or()
      if (!this.take(')')) this.fail('expected ")"')
      return value
    }
    const key = this.identifier()
    if (!key) this.fail('expected a key')
    if (this.take('==')) return { kind: 'compare', key, operator: '==', value: this.quoted() }
    if (this.take('!=')) return { kind: 'compare', key, operator: '!=', value: this.quoted() }
    return { kind: 'key', key }
  }

  private identifier(): string {
    this.space()
    const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(this.input.slice(this.at))
    if (!match) return ''
    this.at += match[0].length
    return match[0]
  }

  private quoted(): string {
    this.space()
    if (this.input[this.at] !== "'") this.fail('expected a single-quoted value')
    this.at++
    let result = ''
    while (this.at < this.input.length && this.input[this.at] !== "'") {
      const char = this.input[this.at++]
      if (char === '\\') {
        const escaped = this.input[this.at++]
        if (escaped !== "'" && escaped !== '\\') this.fail('unsupported escape')
        result += escaped
      } else result += char
    }
    if (this.input[this.at] !== "'") this.fail('unterminated string')
    this.at++
    return result
  }

  private take(token: string): boolean {
    this.space()
    if (!this.input.startsWith(token, this.at)) return false
    this.at += token.length
    return true
  }

  private space(): void { while (/\s/.test(this.input[this.at] ?? '') && this.at < this.input.length) this.at++ }
  private fail(message: string): never { throw new SyntaxError(`Invalid when expression at ${this.at}: ${message}`) }
}

function evaluate(node: Node, context: WhenContext): boolean {
  switch (node.kind) {
    case 'key': return Object.hasOwn(context, node.key) && Boolean(context[node.key])
    case 'compare': {
      const value = Object.hasOwn(context, node.key) ? context[node.key] : undefined
      return node.operator === '==' ? value === node.value : value !== node.value
    }
    case 'not': return !evaluate(node.value, context)
    case 'and': return evaluate(node.left, context) && evaluate(node.right, context)
    case 'or': return evaluate(node.left, context) || evaluate(node.right, context)
  }
}

/** Parse once and return a reusable, non-eval condition. */
export function compileWhen(expression: string): (context: WhenContext) => boolean {
  if (typeof expression !== 'string' || !expression.trim()) throw new SyntaxError('Invalid when expression: expected a condition')
  const tree = new Parser(expression).parse()
  return (context) => evaluate(tree, context)
}
