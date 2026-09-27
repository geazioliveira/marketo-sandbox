import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import {
  loadHookLib,
  type ParsedCommand,
  type ShellLib,
  type SimpleCommand,
  setupTimeout,
  processTimeout,
} from '../support/hooks'

/**
 * The shell parser (.claude/hooks/lib/shell.mjs). The rules judge argv, so
 * this is where a `gh` hidden behind quoting, a wrapper, a substitution or a
 * `bash -c` either reaches them or slips past. Each case names the shell form
 * it reads; the argv expected is the one bash would build.
 */

let shell: ShellLib

vi.setConfig({ testTimeout: processTimeout })

beforeAll(async () => {
  shell = await loadHookLib<ShellLib>('shell')
}, setupTimeout)

const parse = (text: string): ParsedCommand => shell.parseCommand(text)

/**
 * What `env -i` takes away that the rules read, written empty as `unset` is
 * (Copilot review of #26, seventh round).
 */
const clearedByEnvI = Object.fromEntries(
  [
    'HOME',
    'XDG_CONFIG_HOME',
    'GIT_CONFIG',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_NOSYSTEM',
    'GH_HOST',
    'GH_REPO',
    'GIT_DIR',
  ].map((name) => [name, '']),
)
const argvs = (text: string): string[][] =>
  parse(text).commands.map((command) => command.argv)
/** The one command whose argv starts with these words. */
const find = (parsed: ParsedCommand, ...head: string[]): SimpleCommand => {
  const hit = parsed.commands.find((command) =>
    head.every((word, index) => command.argv[index] === word),
  )
  if (hit === undefined)
    throw new Error(
      `nenhum comando começa com ${head.join(' ')}: ${JSON.stringify(parsed.commands.map((c) => c.argv))}`,
    )
  return hit
}

describe('words and quoting', () => {
  it('splits plain words on blanks and tabs', () => {
    expect(argvs('gh  issue\tview   5')).toEqual([['gh', 'issue', 'view', '5']])
  })

  it('keeps single-quoted text literal, $ and backslash included', () => {
    const parsed = parse(`echo 'a b' 'c"d' '$x \\n'`)
    expect(parsed.commands[0].argv).toEqual(['echo', 'a b', 'c"d', '$x \\n'])
    expect(parsed.commands[0].known).toEqual([true, true, true, true])
  })

  it('reads the escapes of double quotes and keeps other backslashes', () => {
    const parsed = parse('echo "a \\"b\\" \\\\ \\$x \\` \\n"')
    expect(parsed.commands[0].argv[1]).toBe('a "b" \\ $x ` \\n')
    expect(parsed.commands[0].known[1]).toBe(true)
  })

  it('reads backslash escapes outside quotes', () => {
    const parsed = parse('echo a\\ b \\$x \\"q\\"')
    expect(parsed.commands[0].argv).toEqual(['echo', 'a b', '$x', '"q"'])
    expect(parsed.commands[0].known).toEqual([true, true, true, true])
  })

  it('joins line continuations, outside and inside double quotes', () => {
    expect(argvs('gh issue \\\n  view 5')).toEqual([
      ['gh', 'issue', 'view', '5'],
    ])
    expect(argvs('echo "a\\\nb"')).toEqual([['echo', 'ab']])
  })

  it('concatenates adjacent quoted and bare parts into one word', () => {
    expect(argvs(`a"b"'c'd g"h"`)).toEqual([['abcd', 'gh']])
  })

  it('keeps empty quoted words as arguments', () => {
    expect(argvs(`echo '' ""`)).toEqual([['echo', '', '']])
  })

  it("decodes $'...' (ANSI-C quoting) as a known literal", () => {
    const parsed = parse(
      "gh issue comment 5 --body $'# Owner Approve\\n\\nok \\'x\\' \\x41\\101\\u00e9\\t|'",
    )
    const body = parsed.commands[0].argv[5]
    expect(body).toBe("# Owner Approve\n\nok 'x' AAé\t|")
    expect(parsed.commands[0].known[5]).toBe(true)
  })

  it('reads $"..." as double-quoted text', () => {
    expect(argvs('echo $"olá $x"')[0][1]).toBe('olá $x')
  })

  it('expands a leading ~ to the home directory, and only that', () => {
    expect(argvs('cat ~/a ~ a~b ~user "~/q"')[0]).toEqual([
      'cat',
      path.join(homedir(), 'a'),
      homedir(),
      'a~b',
      '~user',
      '~/q',
    ])
  })

  it('drops comments, but not a # inside a word', () => {
    expect(argvs('git log # gh issue reopen 5')).toEqual([['git', 'log']])
    expect(argvs('echo a#b')).toEqual([['echo', 'a#b']])
    expect(argvs('# gh issue reopen 5\ngit status')).toEqual([
      ['git', 'status'],
    ])
  })
})

describe('operators and lists', () => {
  it('splits on &&, ||, ;, |, |&, & and newlines', () => {
    expect(argvs('a && b || c; d | e |& f & g\nh')).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['d'],
      ['e'],
      ['f'],
      ['g'],
      ['h'],
    ])
  })

  it('splits a URL at an unquoted & as bash does', () => {
    expect(argvs('curl https://x?a=1&b=2')).toEqual([['curl', 'https://x?a=1']])
  })

  it('reads subshells and groups as separators', () => {
    expect(argvs('(git status); { gh issue reopen 5; }')).toEqual([
      ['git', 'status'],
      ['gh', 'issue', 'reopen', '5'],
    ])
  })

  it('reads the commands inside if, while, until and for', () => {
    expect(
      argvs(
        'if gh issue view 5; then gh issue reopen 5; elif x; then y; else git push; fi',
      ),
    ).toEqual([
      ['gh', 'issue', 'view', '5'],
      ['gh', 'issue', 'reopen', '5'],
      ['x'],
      ['y'],
      ['git', 'push'],
    ])
    expect(
      argvs('while read n; do gh issue edit "$n" --add-label x; done < list'),
    ).toEqual([
      ['read', 'n'],
      ['gh', 'issue', 'edit', '$n', '--add-label', 'x'],
    ])
    expect(argvs('for n in 1 2; do gh issue reopen $n; done')).toEqual([
      ['gh', 'issue', 'reopen', '1'],
      ['gh', 'issue', 'reopen', '2'],
    ])
    expect(argvs('for n in *; do gh issue reopen $n; done')).toEqual([
      ['gh', 'issue', 'reopen', '$n'],
    ])
    expect(argvs('until false; do git push; done')).toEqual([
      ['false'],
      ['git', 'push'],
    ])
  })

  it('reads a negated command and function bodies', () => {
    expect(argvs('! gh issue reopen 5')).toEqual([
      ['gh', 'issue', 'reopen', '5'],
    ])
    expect(argvs('f() { gh issue reopen 5; }')).toEqual([
      ['f'],
      ['gh', 'issue', 'reopen', '5'],
    ])
    expect(argvs('function f { gh issue reopen 5; }')).toEqual([
      ['gh', 'issue', 'reopen', '5'],
    ])
  })

  it('reads case branches without taking patterns for commands', () => {
    const parsed = parse(
      'case "$x" in\n  a|b) gh issue reopen 5 ;;\n  *) (cd y; git push) ;;\nesac\ngit status',
    )
    expect(parsed.unparsable).toBe(false)
    expect(parsed.commands.map((command) => command.argv)).toEqual([
      ['gh', 'issue', 'reopen', '5'],
      ['cd', 'y'],
      ['git', 'push'],
      ['git', 'status'],
    ])
  })

  it('reads a case on one line, and a last branch with no ;;', () => {
    const parsed = parse(
      'case $1 in (a) git push;; b|c) gh issue reopen 5; esac; git log',
    )
    expect(parsed.unparsable).toBe(false)
    expect(parsed.commands.map((command) => command.argv)).toEqual([
      ['git', 'push'],
      ['gh', 'issue', 'reopen', '5'],
      ['git', 'log'],
    ])
    expect(argvs('case x in\n a) git push\nesac\ngit log')).toEqual([
      ['git', 'push'],
      ['git', 'log'],
    ])
  })

  it('runs a substitution in a case word and patterns', () => {
    const parsed = parse('case "$(gh issue reopen 5)" in $(git push)) x;; esac')
    expect(find(parsed, 'gh').argv).toEqual(['gh', 'issue', 'reopen', '5'])
    expect(find(parsed, 'git').argv).toEqual(['git', 'push'])
  })

  it('does not read a quoted reserved word as one', () => {
    expect(argvs(`'if' x`)).toEqual([['if', 'x']])
  })

  it('keeps the raw text of each simple command', () => {
    expect(
      parse('gh issue view 5 > out  &&  git log --oneline').commands.map(
        (command) => command.text,
      ),
    ).toEqual(['gh issue view 5 > out', 'git log --oneline'])
  })
})

describe('redirections', () => {
  it.each([
    ['gh issue view 5 > out.txt 2>&1'],
    ['gh issue view 5 >> out.txt'],
    ['gh issue view 5 2> err.txt'],
    ['gh issue view 5 &> all.txt'],
    ['gh issue view 5 &>> all.txt'],
    ['gh issue view 5 >| out.txt'],
    ['gh issue view 5 <> io.txt'],
    ['gh issue view 5 3>&-'],
    ['gh issue view 5 >out.txt'],
    ['>out.txt gh issue view 5'],
  ])('drops them from argv: %s', (text) => {
    expect(argvs(text)).toEqual([['gh', 'issue', 'view', '5']])
  })

  it('reads digits as a descriptor only when they make the whole word', () => {
    expect(argvs('echo a2>x')).toEqual([['echo', 'a2']])
    expect(argvs('echo 2 >x')).toEqual([['echo', '2']])
  })

  it('records the file of a < redirection', () => {
    const command = parse('gh issue comment 5 -F - < body.md').commands[0]
    expect(command.argv).toEqual(['gh', 'issue', 'comment', '5', '-F', '-'])
    expect(command.stdinFile).toBe('body.md')
    expect(command.stdin).toBeNull()
  })

  it('is unparsable when a redirection has no target', () => {
    expect(parse('echo >').unparsable).toBe(true)
    expect(parse('echo > && b').unparsable).toBe(true)
  })
})

describe('heredocs and here-strings', () => {
  it("reads a <<'EOF' body literally, as the command's stdin", () => {
    const command = parse(
      "gh issue comment 5 -F - <<'EOF'\n# Owner Approve\n\ncusta $5, `nada`\nEOF",
    ).commands[0]
    expect(command.argv).toEqual(['gh', 'issue', 'comment', '5', '-F', '-'])
    expect(command.stdin).toBe('# Owner Approve\n\ncusta $5, `nada`\n')
    expect(command.stdinKnown).toBe(true)
  })

  it('reads <<"EOF" and <<\\EOF as quoted too', () => {
    for (const opener of ['<<"EOF"', '<<\\EOF', "<< 'EOF'", '<<E"O"F']) {
      const command = parse(`cat ${opener}\n$HOME\nEOF`).commands[0]
      expect(command.stdin).toBe('$HOME\n')
      expect(command.stdinKnown).toBe(true)
    }
  })

  it('reads an unquoted <<EOF body with its escapes, unknown when it expands', () => {
    const plain = parse('cat <<EOF\ncusta \\$5\nEOF').commands[0]
    expect(plain.stdin).toBe('custa $5\n')
    expect(plain.stdinKnown).toBe(true)
    const expanding = parse('cat << EOF\nlabel $LABEL\nEOF').commands[0]
    expect(expanding.stdin).toBe('label $LABEL\n')
    expect(expanding.stdinKnown).toBe(false)
  })

  it('strips leading tabs with <<-, from the body and the delimiter', () => {
    const command = parse('cat <<-EOF\n\t\tum\n\tdois\n\tEOF\ngit log').commands
    expect(command[0].stdin).toBe('um\ndois\n')
    expect(command[1].argv).toEqual(['git', 'log'])
  })

  it('reads two heredocs of one line in order', () => {
    const parsed = parse(
      'cat <<A && gh issue comment 5 -F - <<B\nprimeiro\nA\nsegundo\nB\ngit status',
    )
    expect(find(parsed, 'cat').stdin).toBe('primeiro\n')
    expect(find(parsed, 'gh').stdin).toBe('segundo\n')
    expect(find(parsed, 'git', 'status').stdin).toBeNull()
  })

  it('ends a body only at a line that is exactly the delimiter', () => {
    const command = parse('cat <<EOF\nEOFX\n EOF\nEOF').commands[0]
    expect(command.stdin).toBe('EOFX\n EOF\n')
  })

  it('reads a heredoc cut short by the end, and says so', () => {
    const parsed = parse('cat <<EOF\nsem fim')
    expect(parsed.unparsable).toBe(true)
    expect(parsed.commands[0].stdin).toBe('sem fim\n')
    const bare = parse('cat <<EOF')
    expect(bare.unparsable).toBe(true)
    expect(bare.commands[0].stdinKnown).toBe(false)
  })

  it('reads the commit-message heredoc inside $(...), quotes and parens in it', () => {
    const parsed = parse(
      `git commit -m "$(cat <<'EOF'\nCorrigir (#5), don't\n1) item\nEOF\n)" && git status`,
    )
    expect(parsed.unparsable).toBe(false)
    expect(parsed.substitution).toBe(true)
    // Read as its text, trailing newlines dropped as the shell drops them
    // (Copilot review of #26, third round).
    const commit = find(parsed, 'git', 'commit')
    expect(commit.known[3]).toBe(true)
    expect(commit.argv[3]).toBe("Corrigir (#5), don't\n1) item")
    expect(find(parsed, 'cat').stdin).toBe("Corrigir (#5), don't\n1) item\n")
    expect(find(parsed, 'git', 'status').argv).toEqual(['git', 'status'])
  })

  describe('"$(cat <<EOF … EOF)" as a word (Copilot review of #26, third round)', () => {
    const word = (text: string) => {
      const command = find(parse(text), 'git', 'commit')
      return { value: command.argv[3], known: command.known[3] }
    }

    it.each([
      [
        'a quoted delimiter',
        `git commit -m "$(cat <<'EOF'\nHooks $5\nEOF\n)"`,
        'Hooks $5',
      ],
      [
        'an unquoted delimiter, no expansion',
        `git commit -m "$(cat <<EOF\nHooks\n\n\nEOF\n)"`,
        'Hooks',
      ],
      ['cat -', `git commit -m "$(cat - <<'EOF'\nHooks\nEOF\n)"`, 'Hooks'],
      [
        '<<-, tabs stripped',
        `git commit -m "$(cat <<-'EOF'\n\tHooks\n\tEOF\n)"`,
        'Hooks',
      ],
      [
        'text around it',
        `git commit -m "Assunto: $(cat <<'EOF'\ncorpo\nEOF\n)."`,
        'Assunto: corpo.',
      ],
    ])('reads %s', (_, text, value) => {
      expect(word(text)).toEqual({ value, known: true })
    })

    it.each([
      [
        'unquoted, which the shell splits',
        `git commit -m $(cat <<'EOF'\nHooks\nEOF\n)`,
      ],
      [
        'an expansion in the heredoc',
        `git commit -m "$(cat <<EOF\nHooks $X\nEOF\n)"`,
      ],
      ['another program', `git commit -m "$(tr a b <<'EOF'\nHooks\nEOF\n)"`],
      ['cat of a file', 'git commit -m "$(cat msg.txt)"'],
      [
        'cat of a file next to a heredoc, which it does not read',
        `git commit -m "$(cat msg.txt <<'EOF'\nHooks\nEOF\n)"`,
      ],
      [
        'a heredoc on another descriptor than stdin',
        `git commit -m "$(cat 3<<'EOF'\nHooks\nEOF\n)"`,
      ],
      ['a pipeline', `git commit -m "$(cat <<'EOF' | tr a b\nHooks\nEOF\n)"`],
      [
        'a second command',
        `git commit -m "$(cat <<'EOF'; echo x\nHooks\nEOF\n)"`,
      ],
      [
        'cat after a function the line defines',
        `cat() { echo x; }; git commit -m "$(cat <<'EOF'\nHooks\nEOF\n)"`,
      ],
      [
        'cat after an eval',
        `eval "$X"; git commit -m "$(cat <<'EOF'\nHooks\nEOF\n)"`,
      ],
    ])('leaves %s unknown', (_, text) => {
      expect(word(text).known).toBe(false)
    })

    it('fills a variable the line assigned from it', () => {
      const parsed = parse(
        `M="$(cat <<'EOF'\nHooks\nEOF\n)"; git commit -m "$M"`,
      )
      const commit = find(parsed, 'git', 'commit')
      expect(commit.argv[3]).toBe('Hooks')
      expect(commit.known[3]).toBe(true)
    })

    it('trusts one inside a heredoc only while cat is the program', () => {
      const body = `gh issue comment 5 -F - <<EOF\n$(cat <<'X'\nRecado\nX\n)\nEOF`
      const plain = find(parse(body), 'gh')
      expect(plain.stdin).toBe('Recado\n')
      expect(plain.stdinKnown).toBe(true)
      const redefined = find(parse(`cat() { echo x; }; ${body}`), 'gh')
      expect(redefined.stdinKnown).toBe(false)
    })

    it('keeps the raw text of one it does not trust, $ and all', () => {
      const parsed = parse(
        `cat() { echo x; }; GH_REPO="$(cat <<'EOF'\na/b\nEOF\n)" gh issue view`,
      )
      expect(find(parsed, 'gh').env.GH_REPO).toMatch(/^"\$\(cat/)
    })
  })

  it('runs a substitution inside an unquoted heredoc body', () => {
    const parsed = parse('cat <<EOF\n$(gh issue reopen 5)\nEOF')
    expect(parsed.substitution).toBe(true)
    expect(find(parsed, 'gh').argv).toEqual(['gh', 'issue', 'reopen', '5'])
    expect(find(parsed, 'cat').stdinKnown).toBe(false)
  })

  it('does not run a substitution inside a quoted heredoc body', () => {
    const parsed = parse("cat <<'EOF'\n$(gh issue reopen 5)\nEOF")
    expect(parsed.substitution).toBe(false)
    expect(argvs("cat <<'EOF'\n$(gh issue reopen 5)\nEOF")).toEqual([['cat']])
  })

  it('reads a here-string as stdin with a newline, known when literal', () => {
    const literal = parse("gh issue comment 5 -F - <<< '# Owner Approve'")
      .commands[0]
    expect(literal.stdin).toBe('# Owner Approve\n')
    expect(literal.stdinKnown).toBe(true)
    const expanding = parse('gh issue comment 5 -F - <<<"$BODY"').commands[0]
    expect(expanding.stdinKnown).toBe(false)
  })

  it('gives a piped command no stdin, and its own heredoc wins over the pipe', () => {
    const parsed = parse(
      "cat <<'EOF' | gh issue comment 5 -F -\ncorpo\nEOF\necho x | tee <<'B'\nb\nB",
    )
    expect(find(parsed, 'cat').stdin).toBe('corpo\n')
    expect(find(parsed, 'gh').stdin).toBeNull()
    expect(find(parsed, 'gh').stdinKnown).toBe(false)
    expect(find(parsed, 'tee').stdin).toBe('b\n')
  })
})

describe('substitutions', () => {
  it('appends the commands of $(...) and marks the word unknown', () => {
    const parsed = parse('echo $(gh issue reopen 5) done')
    expect(parsed.substitution).toBe(true)
    expect(parsed.commands.map((command) => command.argv)).toEqual([
      ['echo', '$(gh issue reopen 5)', 'done'],
      ['gh', 'issue', 'reopen', '5'],
    ])
    expect(parsed.commands[0].known).toEqual([true, false, true])
  })

  it('reads backticks, and keeps them as $(...) text so a $ check sees them', () => {
    const parsed = parse('echo `gh issue reopen 5` "x `git push` y"')
    expect(parsed.substitution).toBe(true)
    expect(parsed.commands[0].argv).toEqual([
      'echo',
      '$(gh issue reopen 5)',
      'x $(git push) y',
    ])
    expect(find(parsed, 'gh').argv).toEqual(['gh', 'issue', 'reopen', '5'])
    expect(find(parsed, 'git').argv).toEqual(['git', 'push'])
  })

  it('reads a substitution inside double quotes', () => {
    const parsed = parse('echo "x $(git push origin main) y"')
    expect(find(parsed, 'git').argv).toEqual(['git', 'push', 'origin', 'main'])
  })

  it('reads nested substitutions', () => {
    const parsed = parse('echo $(echo $(echo "$(gh issue reopen 5)"))')
    expect(find(parsed, 'gh').argv).toEqual(['gh', 'issue', 'reopen', '5'])
  })

  it('tells arithmetic from a substitution that opens a subshell', () => {
    const arithmetic = parse('echo $((1 + 2)) $(( (3) ))')
    expect(arithmetic.substitution).toBe(false)
    expect(arithmetic.commands).toHaveLength(1)
    expect(arithmetic.commands[0].known).toEqual([true, false, false])
    const subshell = parse('echo $( (gh issue reopen 5) ) $((git push) )')
    expect(subshell.substitution).toBe(true)
    expect(find(subshell, 'gh').argv).toEqual(['gh', 'issue', 'reopen', '5'])
    expect(find(subshell, 'git').argv).toEqual(['git', 'push'])
  })

  it('reads a substitution inside arithmetic and inside ${...}', () => {
    const parsed = parse(
      'echo $(( $(gh issue reopen 5) + 1 )) ${x:-$(git push)}',
    )
    expect(parsed.substitution).toBe(true)
    expect(find(parsed, 'gh').argv).toEqual(['gh', 'issue', 'reopen', '5'])
    expect(find(parsed, 'git').argv).toEqual(['git', 'push'])
  })

  it('keeps $VAR and ${VAR} literal and unknown, with no substitution', () => {
    const parsed = parse('gh issue edit $N --add-label ${L} "$@" $1')
    expect(parsed.substitution).toBe(false)
    expect(parsed.commands[0].argv).toEqual([
      'gh',
      'issue',
      'edit',
      '$N',
      '--add-label',
      '${L}',
      '$@',
      '$1',
    ])
    expect(parsed.commands[0].known).toEqual([
      true,
      true,
      true,
      false,
      true,
      false,
      false,
      false,
    ])
  })

  it('keeps a lone $ as a known literal', () => {
    const parsed = parse('echo $ "a $ b"')
    expect(parsed.commands[0].argv).toEqual(['echo', '$', 'a $ b'])
    expect(parsed.commands[0].known).toEqual([true, true, true])
  })

  it('reads process substitutions', () => {
    const parsed = parse('diff <(gh issue view 1) >(git push)')
    expect(parsed.substitution).toBe(true)
    expect(find(parsed, 'gh').argv).toEqual(['gh', 'issue', 'view', '1'])
    expect(find(parsed, 'git').argv).toEqual(['git', 'push'])
  })

  it('reads a substitution in an assignment with no command', () => {
    const parsed = parse('X=$(gh issue reopen 5)')
    expect(parsed.commands.map((command) => command.argv)).toEqual([
      ['gh', 'issue', 'reopen', '5'],
    ])
  })

  it('runs a substitution in the directory of its command', () => {
    const parsed = parse('cd sub && echo $(git push)')
    expect(find(parsed, 'git').cwd).toBe('sub')
  })

  it('does not read a substitution inside single quotes', () => {
    const parsed = parse(`echo '$(gh issue reopen 5)' '\`git push\`'`)
    expect(parsed.substitution).toBe(false)
    expect(parsed.commands).toHaveLength(1)
  })
})

describe('assignments and wrappers', () => {
  it('moves leading assignments into env', () => {
    const command = parse('GH_REPO=a/b FOO="x y" N+=1 gh issue view 5')
      .commands[0]
    expect(command.argv).toEqual(['gh', 'issue', 'view', '5'])
    expect(command.env).toEqual({ GH_REPO: 'a/b', FOO: 'x y', N: '1' })
  })

  it('reads a quoted assignment as the command, and a later one as an argument', () => {
    expect(argvs('"A=1" gh')).toEqual([['A=1', 'gh']])
    expect(argvs('gh A=1')).toEqual([['gh', 'A=1']])
  })

  it('runs nothing for an assignment alone, an array included', () => {
    expect(argvs('A=1 B=(x "y z")')).toEqual([])
    expect(parse('A=(x y); gh issue view 5').unparsable).toBe(false)
  })

  it.each([
    ['env', 'env gh issue reopen 5', {}],
    [
      'env -i with assignments',
      'env -i A=1 B=2 gh issue reopen 5',
      { ...clearedByEnvI, A: '1', B: '2' },
    ],
    ['env -u', 'env -u X -- gh issue reopen 5', {}],
    ['command', 'command gh issue reopen 5', {}],
    ['command -p', 'command -p gh issue reopen 5', {}],
    ['exec', 'exec gh issue reopen 5', {}],
    ['exec -a', 'exec -a nome gh issue reopen 5', {}],
    ['nohup', 'nohup gh issue reopen 5 &', {}],
    ['time', 'time gh issue reopen 5', {}],
    ['time -p', 'time -p gh issue reopen 5', {}],
    ['sudo', 'sudo gh issue reopen 5', {}],
    ['sudo -u', 'sudo -u root -E gh issue reopen 5', {}],
    ['sudo with assignments', 'sudo A=1 gh issue reopen 5', { A: '1' }],
    ['builtin', 'builtin gh issue reopen 5', {}],
    ['nice', 'nice -n 5 gh issue reopen 5', {}],
    ['timeout', 'timeout -s KILL 30 gh issue reopen 5', {}],
    ['xargs', 'xargs -I {} gh issue reopen 5', {}],
    ['a path to the program', '/opt/homebrew/bin/gh issue reopen 5', {}],
    ['env by path', '/usr/bin/env gh issue reopen 5', {}],
    ['a backslash before the name', '\\gh issue reopen 5', {}],
    ['a quoted name', `'gh' issue reopen 5`, {}],
    [
      'wrappers stacked',
      'sudo env A=1 nohup time command gh issue reopen 5',
      { A: '1' },
    ],
    [
      'an assignment before a wrapper',
      'A=1 sudo gh issue reopen 5',
      { A: '1' },
    ],
  ])('unwraps %s', (_label, text, env) => {
    const command = parse(text).commands.at(-1)!
    expect(command.argv).toEqual(['gh', 'issue', 'reopen', '5'])
    expect(command.env).toEqual(env)
  })

  it('does not unwrap command -v, which only looks the program up', () => {
    expect(argvs('command -v gh')).toEqual([['command', '-v', 'gh']])
  })

  it('reads the directory env -C and sudo -D run the command in', () => {
    expect(parse('env -C sub gh issue view 5').commands[0].cwd).toBe('sub')
    expect(parse('sudo -D /srv gh issue view 5').commands[0].cwd).toBe('/srv')
  })

  it('splits the string of env -S into words', () => {
    expect(argvs(`env -S 'gh issue reopen 5'`)).toEqual([
      ['gh', 'issue', 'reopen', '5'],
    ])
  })

  it('gives xargs its stdin, not the command it runs', () => {
    const command = parse("xargs gh issue comment 5 -F - <<< 'x'").commands[0]
    expect(command.argv[0]).toBe('gh')
    expect(command.stdin).toBeNull()
  })

  it('leaves a wrapper with no command as it is', () => {
    expect(argvs('env')).toEqual([['env']])
    expect(argvs('sudo -v')).toEqual([['sudo', '-v']])
  })
})

describe('shells, eval and scripts', () => {
  it.each([
    ["bash -c 'gh issue reopen 5'"],
    ['sh -c "gh issue reopen 5"'],
    ["zsh -c 'gh issue reopen 5'"],
    ["bash -lc 'gh issue reopen 5'"],
    ["bash -l -c 'gh issue reopen 5'"],
    ["bash --login -c 'gh issue reopen 5'"],
    ["bash -o pipefail -c 'gh issue reopen 5'"],
    ["/bin/bash -c 'gh issue reopen 5' nome arg"],
    ['bash -c "sh -c \'gh issue reopen 5\'"'],
    ["eval 'gh issue reopen 5'"],
    ['eval gh issue reopen 5'],
    ["bash <<'EOF'\ngh issue reopen 5\nEOF"],
    ["sh -s <<< 'gh issue reopen 5'"],
  ])('reads the script of %j', (text) => {
    const parsed = parse(text)
    expect(find(parsed, 'gh').argv).toEqual(['gh', 'issue', 'reopen', '5'])
  })

  it('keeps the outer shell command and appends the script commands after it', () => {
    expect(argvs(`bash -c 'cd sub && git commit -m x'; git status`)).toEqual([
      ['bash', '-c', 'cd sub && git commit -m x'],
      ['git', 'status'],
      ['cd', 'sub'],
      ['git', 'commit', '-m', 'x'],
    ])
  })

  it('runs the script in the shell directory, its cd scoped to it', () => {
    const parsed = parse(`cd a && bash -c 'cd b && git push' && git status`)
    expect(find(parsed, 'git', 'push').cwd).toBe(path.join('a', 'b'))
    expect(find(parsed, 'git', 'status').cwd).toBe('a')
  })

  it('passes assignments before the shell on to the script', () => {
    const parsed = parse(`GH_REPO=o/r bash -c 'gh issue view 5'`)
    expect(find(parsed, 'gh').env).toEqual({ GH_REPO: 'o/r' })
  })

  it('does not read a script file as a script', () => {
    expect(argvs('bash script.sh gh')).toEqual([['bash', 'script.sh', 'gh']])
  })
})

describe('the directory, from cd', () => {
  it('moves the commands after it, relative to the one before', () => {
    const parsed = parse('cd sub && git commit -m x; cd deeper && git push')
    expect(find(parsed, 'cd', 'sub').cwd).toBeNull()
    expect(find(parsed, 'git', 'commit').cwd).toBe('sub')
    expect(find(parsed, 'git', 'push').cwd).toBe(path.join('sub', 'deeper'))
  })

  it('takes an absolute directory as it is, and .. as written', () => {
    expect(find(parse('cd /abs/x && git push'), 'git').cwd).toBe('/abs/x')
    expect(find(parse('cd .. && git push'), 'git').cwd).toBe('..')
  })

  it('goes home with no operand or ~, and skips its options', () => {
    expect(find(parse('cd && git push'), 'git').cwd).toBe(homedir())
    expect(find(parse('cd ~/p && git push'), 'git').cwd).toBe(
      path.join(homedir(), 'p'),
    )
    expect(find(parse('cd -P -- sub && git push'), 'git').cwd).toBe('sub')
  })

  it('goes back with cd - after a cd of the same line', () => {
    expect(find(parse('cd a && cd b && cd - && git push'), 'git').cwd).toBe('a')
    expect(find(parse('cd - && git push'), 'git').cwd).toBeNull()
  })

  it('follows pushd and popd', () => {
    const parsed = parse('pushd a && git status && popd && git push')
    expect(find(parsed, 'git', 'status').cwd).toBe('a')
    expect(find(parsed, 'git', 'push').cwd).toBeNull()
  })

  it('does not move out of a subshell, a pipeline or the background', () => {
    expect(
      find(parse('(cd a && git push); git status'), 'git', 'push').cwd,
    ).toBe('a')
    expect(
      find(parse('(cd a && git push); git status'), 'git', 'status').cwd,
    ).toBeNull()
    expect(find(parse('cd a | git push'), 'git').cwd).toBeNull()
    expect(find(parse('cd a & git push'), 'git').cwd).toBeNull()
  })

  it('keeps an expanding directory as written, for the caller to resolve', () => {
    expect(find(parse('cd "$DIR" && git push'), 'git').cwd).toBe('$DIR')
    expect(
      find(
        parse('cd sub && cd $(git rev-parse --show-toplevel) && git push'),
        'git',
        'push',
      ).cwd,
    ).toBe(path.join('sub', '$(git rev-parse --show-toplevel)'))
  })
})

describe('unparsable and pathological input', () => {
  it.each([
    [`echo 'abc`, ['echo', 'abc']],
    ['echo "abc', ['echo', 'abc']],
    ['echo `abc', ['echo', '$(abc)']],
  ])('reads %j best-effort and says it is unparsable', (text, argv) => {
    const parsed = parse(text)
    expect(parsed.unparsable).toBe(true)
    expect(parsed.commands[0].argv).toEqual(argv)
  })

  it('still finds the commands of an unterminated substitution', () => {
    const parsed = parse('echo $(gh issue reopen 5')
    expect(parsed.unparsable).toBe(true)
    expect(find(parsed, 'gh').argv).toEqual(['gh', 'issue', 'reopen', '5'])
  })

  it.each(['', '   ', '\n\n\t\n', '# só um comentário'])(
    'reads %j as no command, and not unparsable',
    (text) => {
      expect(parse(text)).toEqual({
        commands: [],
        unparsable: false,
        substitution: false,
      })
    },
  )

  it.each([';', '&&', '|| |', 'a &&', 'a |', 'a ; ; b', ')', '(a', 'a && ; b'])(
    'reads the syntax error %j as unparsable',
    (text) => {
      expect(parse(text).unparsable).toBe(true)
    },
  )

  it('lets a list continue on the next line after && or |', () => {
    const parsed = parse('git status &&\n  git log |\n  head')
    expect(parsed.unparsable).toBe(false)
    expect(parsed.commands).toHaveLength(3)
  })

  it('says unparsable for input that is not a string', () => {
    for (const input of [null, undefined, 42, {}])
      expect(shell.parseCommand(input)).toEqual({
        commands: [],
        unparsable: true,
        substitution: false,
      })
  })

  it('reads a very long list in linear time', () => {
    const text = `${'gh issue view 1 && '.repeat(20_000)}git log`
    const started = Date.now()
    const parsed = parse(text)
    expect(parsed.commands).toHaveLength(20_001)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('reads a very long word and a very long quoted body', () => {
    const word = 'x'.repeat(1_000_000)
    expect(parse(`echo ${word}`).commands[0].argv[1]).toHaveLength(1_000_000)
    expect(parse(`echo '${word}'`).commands[0].argv[1]).toHaveLength(1_000_000)
  })

  it('stops at a depth limit instead of overflowing the stack', () => {
    const nested = `${'$('.repeat(5_000)}gh issue reopen 5${')'.repeat(5_000)}`
    const parsed = parse(`echo ${nested}`)
    expect(parsed.unparsable).toBe(true)
    expect(parse(`${'eval '.repeat(60)}gh issue reopen 5`).unparsable).toBe(
      true,
    )
    for (const opener of ['${', '"${', '$(', '$((', '<(', '`\\`'])
      expect(parse(`echo ${opener.repeat(100_000)}`).unparsable).toBe(true)
  })

  it('does not hang on only operators or stray characters', () => {
    const text = '&|;()<>'.repeat(10_000)
    expect(parse(text).unparsable).toBe(true)
  })
})

describe('options', () => {
  const argv = [
    'gh',
    'issue',
    'comment',
    '5',
    '--body=um',
    '--body',
    'dois',
    '-b',
    'três',
    '-bquatro',
    '-b=cinco',
    '--body-file',
    'f.md',
    '--',
    '--body',
    'depois',
  ]

  it('finds every value of short and long forms, in order, up to --', () => {
    expect(shell.optionValues(argv, ['-b', '--body'])).toEqual([
      'um',
      'dois',
      'três',
      'quatro',
      'cinco',
    ])
    expect(shell.findOptions(argv, ['-b', '--body'])[1]).toEqual({
      name: '--body',
      value: 'dois',
      index: 6,
    })
  })

  it('does not take a longer option for a shorter one', () => {
    expect(shell.optionValues(argv, ['--body-file'])).toEqual(['f.md'])
    expect(shell.optionValues(['gh', '--bodyx', 'a'], ['--body'])).toEqual([])
  })

  it('takes the next word as the value whatever it looks like', () => {
    expect(
      shell.optionValues(['gh', '-b', '--web', '-l', 'x'], ['-b', '-l']),
    ).toEqual(['--web', 'x'])
  })

  it('leaves out an option with no value after it', () => {
    expect(shell.optionValues(['gh', 'pr', 'create', '-b'], ['-b'])).toEqual([])
  })

  it('matches abbreviated long options only when asked, as git takes them', () => {
    const commit = ['git', 'commit', '--mess', 'x', '--me=y']
    expect(shell.optionValues(commit, ['-m', '--message'])).toEqual([])
    expect(
      shell.optionValues(commit, ['-m', '--message'], { abbreviations: true }),
    ).toEqual(['x'])
  })
})

describe('readBody', () => {
  let base: string

  beforeEach(() => {
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'read-body-')))
    mkdirSync(path.join(base, 'sub'))
    writeFileSync(path.join(base, 'sub', 'body.md'), '# Plano\n\ntexto\n')
    writeFileSync(path.join(base, 'top.md'), 'no topo\n')
  }, setupTimeout)

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  }, setupTimeout)

  const body = (text: string, index = 0) =>
    shell.readBody(parse(text).commands[index], base)

  it('reads an inline body', () => {
    expect(body(`gh issue comment 5 --body '# Owner Approve'`)).toMatchObject({
      known: true,
      text: '# Owner Approve',
      source: 'inline',
    })
    expect(body('gh issue comment 5 -b ok').text).toBe('ok')
  })

  it('reads a $ that bash leaves alone as known', () => {
    expect(body(`gh issue comment 5 -b 'custa $5'`)).toMatchObject({
      known: true,
      text: 'custa $5',
    })
  })

  it.each([
    ['a variable', 'gh issue comment 5 --body "$BODY"'],
    ['a substitution', 'gh issue comment 5 --body "$(cat x.md)"'],
    ['backticks', 'gh issue comment 5 --body `cat x.md`'],
  ])('reads a body with %s as unknown', (_label, text) => {
    expect(body(text)).toMatchObject({
      known: false,
      text: null,
      source: 'inline',
    })
  })

  it('reads a file relative to the command cwd, resolved against the base', () => {
    expect(body('cd sub && gh issue comment 5 -F body.md', 1)).toMatchObject({
      known: true,
      text: '# Plano\n\ntexto\n',
      source: 'file',
    })
    expect(body('gh issue comment 5 --body-file top.md').text).toBe('no topo\n')
    expect(
      body(
        `gh issue comment 5 --body-file=${path.join(base, 'sub', 'body.md')}`,
      ).text,
    ).toBe('# Plano\n\ntexto\n')
  })

  it.each([
    ['a missing file', 'gh issue comment 5 -F nao-existe.md'],
    ['a directory', 'gh issue comment 5 -F sub'],
    ['a file named by a variable', 'gh issue comment 5 -F "$F"'],
    ['a file named by a substitution', 'gh issue comment 5 -F "$(mktemp)"'],
  ])('reads %s as unknown', (_label, text) => {
    expect(body(text)).toMatchObject({
      known: false,
      text: null,
      source: 'file',
    })
  })

  it('reads - as the command stdin: a heredoc, a here-string, a < file', () => {
    expect(
      body("gh issue comment 5 -F - <<'EOF'\n# Approve retirado\nEOF"),
    ).toMatchObject({
      known: true,
      text: '# Approve retirado\n',
      source: 'stdin',
    })
    expect(body("gh issue comment 5 -F /dev/stdin <<< 'oi'").text).toBe('oi\n')
    expect(
      body('cd sub && gh issue comment 5 -F - < body.md', 1),
    ).toMatchObject({
      known: true,
      text: '# Plano\n\ntexto\n',
      source: 'stdin',
    })
  })

  it('reads - as unknown when stdin is a pipe, missing or expanding', () => {
    for (const text of [
      'cat x | gh issue comment 5 -F -',
      'gh issue comment 5 -F -',
      'gh issue comment 5 -F - <<EOF\n$BODY\nEOF',
      'gh issue comment 5 -F - < nao-existe.md',
    ]) {
      const read = shell.readBody(find(parse(text), 'gh'), base)
      expect(read).toMatchObject({ known: false, text: null, source: 'stdin' })
    }
  })

  it('reads an editor or a browser as unknown', () => {
    expect(body('gh issue create -t x -e')).toMatchObject({
      known: false,
      source: 'editor',
    })
    expect(body('gh issue comment 5 --web')).toMatchObject({
      known: false,
      source: 'web',
    })
    expect(body('gh issue comment 5 -b "-w"')).toMatchObject({
      known: true,
      text: '-w',
    })
  })

  it('reads no body option as known and empty', () => {
    expect(body('gh issue edit 5 --add-label x')).toEqual({
      known: true,
      text: null,
      source: 'none',
      all: [],
    })
  })

  it('lets the last body win, and lists them all', () => {
    const read = body(`gh issue comment 5 -b '# Owner Approve' -b ok`)
    expect(read.text).toBe('ok')
    expect(read.all.map((part) => part.text)).toEqual(['# Owner Approve', 'ok'])
  })

  it('takes other flags when asked', () => {
    const command = parse(`gh pr merge 5 -b corpo --subject '[skip ci]'`)
      .commands[0]
    expect(
      shell.readBody(command, base, {
        bodyFlags: ['--subject', '-t'],
        fileFlags: [],
      }).text,
    ).toBe('[skip ci]')
  })

  it('falls back to a $ check for a command built by hand', () => {
    expect(
      shell.readBody({ argv: ['gh', 'issue', 'comment', '-b', '$X'] }, base),
    ).toMatchObject({ known: false })
    expect(
      shell.readBody(
        { argv: ['gh', 'issue', 'comment', '-F', '-'], stdin: 'oi\n' },
        base,
      ),
    ).toMatchObject({ known: true, text: 'oi\n' })
  })
})

/**
 * Variables the line assigns (#5, from the corpus of real commands): a
 * variable assigned for sure earlier on the line, to a value known in full,
 * is filled in where the line uses it; everything else stays unknown. The
 * expansion only ever makes the rules see more: what it cannot be sure of is
 * left as it was.
 */
describe('variables the line assigns', () => {
  /** argv and known of the last command `head` of the line. */
  const words = (text: string, head = 'echo') => {
    const command = parse(text)
      .commands.filter((each) => each.argv[0] === head)
      .at(-1)
    if (command === undefined) throw new Error(`nenhum ${head} em ${text}`)
    return command.argv.map((value, index) => [value, command.known[index]])
  }

  it('fills in $NAME and ${NAME}, unquoted and in double quotes', () => {
    expect(
      words('SP=/x; echo "$SP/plano.md" $SP ${SP}/b "${SP}" "a${SP}b"'),
    ).toEqual([
      ['echo', true],
      ['/x/plano.md', true],
      ['/x', true],
      ['/x/b', true],
      ['/x', true],
      ['a/xb', true],
    ])
  })

  it('reads the corpus shapes: a body file, an endpoint, git -C, cd', () => {
    const body = find(
      parse('SP=/tmp/s; gh issue comment 8 --body-file "$SP/plano-8.md"'),
      'gh',
    )
    expect(body.argv.at(-1)).toBe('/tmp/s/plano-8.md')
    expect(body.known.at(-1)).toBe(true)
    expect(
      find(
        parse('R=owner/name; gh api "repos/$R/pulls/14/comments/1/replies"'),
        'gh',
      ).argv[2],
    ).toBe('repos/owner/name/pulls/14/comments/1/replies')
    const git = parse('W="/a b"; git -C "$W" add x && git -C "$W" commit -m m')
    expect(git.commands.map((command) => command.argv[2])).toEqual([
      '/a b',
      '/a b',
    ])
    const cd = parse('SP=/tmp/s; cd "$SP/rewrite" && git init && git commit')
    expect(find(cd, 'git', 'commit').cwd).toBe('/tmp/s/rewrite')
  })

  it('makes detection stronger: the rules see the label and the Approve', () => {
    expect(
      find(parse('R=ready-for-agent; gh issue edit 5 --add-label $R'), 'gh')
        .argv,
    ).toEqual(['gh', 'issue', 'edit', '5', '--add-label', 'ready-for-agent'])
    expect(
      find(parse('B="# Owner Approve"; gh issue comment 5 --body "$B"'), 'gh')
        .argv[5],
    ).toBe('# Owner Approve')
    expect(
      find(parse('G=gh; $G issue edit 5 --add-label ready-for-agent'), 'gh')
        .argv,
    ).toEqual(['gh', 'issue', 'edit', '5', '--add-label', 'ready-for-agent'])
    const script = parse(
      `C='gh issue reopen 5'; bash -c "$C"; S=reopen; bash -c 'gh issue $S 5'`,
    )
    expect(
      script.commands.filter((command) => command.argv[0] === 'gh').length,
    ).toBe(2)
    expect(find(script, 'gh').argv).toEqual(['gh', 'issue', 'reopen', '5'])
  })

  it('reads several assignments, export and readonly, left to right', () => {
    expect(
      words('A=1 B=2; export C=3 D; readonly E=4; F=5 G=$F; echo $A$B$C$E$G'),
    ).toEqual([
      ['echo', true],
      ['12345', true],
    ])
  })

  it('fills in a heredoc, a here-string and a redirection target', () => {
    const heredoc = find(parse('R=abc; cat <<EOF\nlabel $R\nEOF'), 'cat')
    expect(heredoc.stdin).toBe('label abc\n')
    expect(heredoc.stdinKnown).toBe(true)
    const quoted = find(parse("R=abc; cat <<'EOF'\n$R\nEOF"), 'cat')
    expect(quoted.stdin).toBe('$R\n')
    const here = find(
      parse('B="# Plano"; gh issue comment 5 -F - <<<"$B"'),
      'gh',
    )
    expect([here.stdin, here.stdinKnown]).toEqual(['# Plano\n', true])
    const redir = find(parse('SP=/x; echo oi > "$SP/out.md" 2>&1'), 'echo')
    expect(redir.redirs).toEqual([
      { op: '>', fd: null, target: { value: '/x/out.md', known: true } },
      { op: '>&', fd: '2', target: { value: '1', known: true } },
    ])
  })

  it('never fills in single quotes, and expands ~ at the start of a value', () => {
    expect(words("SP=/x; echo '$SP'")).toEqual([
      ['echo', true],
      ['$SP', true],
    ])
    expect(words('A=~/q; echo "$A"')[1]).toEqual([
      path.join(homedir(), 'q'),
      true,
    ])
  })

  it('leaves an unquoted value the shell would split, glob or drop', () => {
    expect(words(`A="x y"; G='*'; E=; echo $A "$A" $G "$G" $E "$E"`)).toEqual([
      ['echo', true],
      ['$A', false],
      ['x y', true],
      ['$G', false],
      ['*', true],
      ['$E', false],
      ['', true],
    ])
  })

  it('leaves every other ${...} form and zsh’s own expansions unknown', () => {
    expect(
      words('R=x; echo ${R:-y} ${#R} ${R/x/y} $R:h $R[1] $=R $~R $^R $+R'),
    ).toEqual([
      ['echo', true],
      ['${R:-y}', false],
      ['${#R}', false],
      ['${R/x/y}', false],
      ['$R:h', false],
      ['$R[1]', false],
      ['$=R', false],
      ['$~R', false],
      ['$^R', false],
      ['$+R', false],
    ])
  })

  it('leaves a name the line never assigns, whatever the environment holds', () => {
    expect(words('echo $HOME $PATH "$SP"')).toEqual([
      ['echo', true],
      ['$HOME', false],
      ['$PATH', false],
      ['$SP', false],
    ])
  })

  it.each([
    ['inside if', 'R=x; if true; then R=y; fi; echo $R'],
    ['in the condition of if', 'R=x; if R=y; then :; fi; echo $R'],
    ['inside for', 'R=x; for i in 1; do R=y; done; echo $R'],
    ['inside while', 'R=x; while false; do R=y; done; echo $R'],
    ['inside case', 'R=x; case a in a) R=y ;; esac; echo $R'],
    ['inside { }', 'R=x; { R=y; }; echo $R'],
    ['inside a subshell', 'R=x; (R=y); echo $R'],
    ['after &&', 'R=x; true && R=y; echo $R'],
    ['after ||', 'R=x; false || R=y; echo $R'],
    ['in a pipeline', 'R=x; echo a | R=y; echo $R'],
    ['in the background', 'R=x; R=y & echo $R'],
    ['before a command only', 'R=x; R=y true; echo $R'],
    ['from a substitution', 'R=x; R=$(date); echo $R'],
    ['by +=', 'R=x; R+=y; echo $R'],
    ['by unset', 'R=x; unset R; echo $R'],
    ['by read', 'R=x; read R < /dev/null; echo $R'],
    ['by printf -v', 'R=x; printf -v R %s y; echo $R'],
    ['by a for header', 'R=x; for R in a b; do :; done; echo $R'],
    ['by declare -n', 'R=x; declare -n R=Q; echo $R'],
    ['by arithmetic', 'R=x; echo $((R=2)) $R'],
    ['by (( ))', 'R=x; ((R++)); echo $R'],
    ['by let', 'R=x; let R=2; echo $R'],
    ['by ${R:=y}', 'R=x; : ${R:=y}; echo $R'],
    ['by eval', 'R=x; eval "$Y"; echo $R'],
    ['by source', 'R=x; source ./env.sh; echo $R'],
    ['by a trap', "R=x; trap 'R=y' DEBUG; echo $R"],
    ['by a function', 'R=x; f() { R=y; }; f; echo $R'],
    ['by a command with an unknown name', 'R=x; $CMD; echo $R'],
    ['by a read of an unknown name', 'R=x; read "$N" < /dev/null; echo $R'],
    ['after IFS changes', 'R=x; IFS=/; echo $R'],
  ])('leaves a name assigned %s unknown', (_, text) => {
    expect(words(text).at(-1)).toEqual(['$R', false])
  })

  it('does not carry a value into a loop or a function that reassigns it', () => {
    expect(words('R=x; for i in 1 2; do echo $R; R=y; done').at(-1)).toEqual([
      '$R',
      false,
    ])
    expect(words('R=x; f() { echo $R; }; R=y; f').at(-1)).toEqual(['$R', false])
  })

  it('hands a shell only what it exports, and eval all of it', () => {
    const exported = parse(`export R=abc; bash -c 'echo $R'`)
    expect(exported.commands.at(-1)?.argv).toEqual(['echo', 'abc'])
    const prefix = parse(`R=abc bash -c 'echo $R'`)
    expect(prefix.commands.at(-1)?.argv).toEqual(['echo', 'abc'])
    const plain = parse(`R=abc; bash -c 'echo $R'`)
    expect(plain.commands.at(-1)?.known).toEqual([true, false])
    const outer = parse(`R=abc; bash -c "echo $R"`)
    expect(outer.commands.at(-1)?.argv).toEqual(['echo', 'abc'])
    const evaluated = parse(`R=abc; eval 'echo $R'`)
    expect(evaluated.commands.at(-1)?.argv).toEqual(['echo', 'abc'])
    const substituted = parse('R=abc; echo "$(echo $R)"')
    expect(substituted.commands.at(-1)?.argv).toEqual(['echo', 'abc'])
  })

  it('does not read a script whose text this line could not fill in', () => {
    // The outer $R is unknown here, so the shell's $R must not be read with
    // the value the prefix gives it.
    const parsed = parse('if :; then R=a; fi; R=b bash -c "echo $R"')
    expect(parsed.commands.at(-1)?.known).toEqual([true, false])
  })
})

describe('an assignment after a && chain that cannot fail (Copilot review of #26, third round)', () => {
  let dir: string
  beforeAll(() => {
    dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'shell-chain-')))
  }, setupTimeout)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const fileOf = (text: string) => {
    const commit = find(parse(text), 'git', 'commit')
    return { value: commit.argv[3], known: commit.known[3] }
  }

  it.each([
    [
      'after cd to a directory that exists',
      (d: string) => `cd "${d}" && S=/tmp/s`,
    ],
    [
      'after another assignment and a cd',
      (d: string) => `A=1 && cd ${d} && S=/tmp/s`,
    ],
  ])('fills a variable assigned %s, for the lines after it', (_, head) => {
    const text = `${head(dir)} && cat > "$S/m.txt" <<'EOF'\nHooks\nEOF\ngit commit -F "$S/m.txt"`
    expect(fileOf(text)).toEqual({ value: '/tmp/s/m.txt', known: true })
  })

  it.each([
    [
      'after a cd to a directory that does not exist',
      'cd /nao/existe && S=/tmp/s',
    ],
    ['after a relative cd', 'cd sub && S=/tmp/s'],
    ['after a command that may fail', 'false && S=/tmp/s'],
    ['after ||', `cd ${'/'} || S=/tmp/s`],
    ['after a subshell', '(cd /) && S=/tmp/s'],
    ['after a pipeline', 'cd / | cat && S=/tmp/s'],
    ['after an assignment of a substitution', 'A=$(false) && S=/tmp/s'],
  ])('leaves a variable assigned %s unknown', (_, head) => {
    expect(fileOf(`${head}\ngit commit -F "$S/m.txt"`).known).toBe(false)
  })
})

describe('an assignment certain for the rest of its && list (Copilot review of #26, third round)', () => {
  const targetOf = (text: string) => {
    const command = find(parse(text), 'npm')
    return command.redirs?.[0]?.target
  }

  it('fills a variable for the commands after it in the same && list', () => {
    expect(
      targetOf('git commit -m x && SP=/tmp/sp && npm run check > $SP/c.log'),
    ).toEqual({ value: '/tmp/sp/c.log', known: true })
    expect(
      targetOf('false && SP=/tmp/sp &&\n  npm run check > "$SP/c.log"'),
    ).toEqual({ value: '/tmp/sp/c.log', known: true })
  })

  it.each([
    ['after the list', 'false && SP=/tmp/sp; npm run check > $SP/c.log'],
    ['after ||', 'false && SP=/tmp/sp || npm run check > $SP/c.log'],
    [
      'past a command that assigns it again',
      'false && SP=/tmp/sp && read SP && npm run check > $SP/c.log',
    ],
    ['in a pipeline', 'false && SP=/tmp/sp | npm run check > $SP/c.log'],
  ])('leaves it unknown %s', (_, text) => {
    expect(targetOf(text)?.known).toBe(false)
  })
})

describe('IFS in the environment of read (Copilot review of #26, third round)', () => {
  it('keeps the variables of the line after `while IFS= read -r f`', () => {
    const parsed = parse(
      'S=/tmp/s\n( while IFS= read -r f; do echo "$f"; done < x ); rm -rf "$S/copy"',
    )
    expect(find(parsed, 'rm').argv[2]).toBe('/tmp/s/copy')
    expect(find(parsed, 'rm').known[2]).toBe(true)
  })

  it.each([
    ['read of IFS itself', 'S=/tmp/s; read IFS; rm -rf "$S/copy"'],
    ['IFS assigned alone', 'S=/tmp/s; IFS=:; rm -rf "$S/copy"'],
    ['IFS before another program', 'S=/tmp/s; IFS=: eval x; rm -rf "$S/copy"'],
    // A special builtin keeps an assignment before it, in POSIX sh.
    ['IFS before a special builtin', 'S=/tmp/s; IFS=/ :; rm -rf "$S/copy"'],
  ])('still stops filling after %s', (_, text) => {
    expect(find(parse(text), 'rm').known[2]).toBe(false)
  })
})

describe('a for loop over values written in full (Copilot review of #26, third round)', () => {
  /** argv and known of every command `head` of the line. */
  const each = (text: string, head: string) =>
    parse(text)
      .commands.filter((command) => command.argv[0] === head)
      .map((command) =>
        command.argv.map((value, index) => [value, command.known[index]]),
      )

  it('reads the body once per value, with the variable filled in', () => {
    const parsed = parse(
      'S=/tmp/s; for i in 1 2; do npx vitest run > "$S/vitest-$i.txt" 2>&1; done',
    )
    expect(
      parsed.commands.map((command) => command.redirs?.[0]?.target),
    ).toEqual([
      { value: '/tmp/s/vitest-1.txt', known: true },
      { value: '/tmp/s/vitest-2.txt', known: true },
    ])
  })

  it('fills in the values from variables the line assigned', () => {
    expect(
      each('S=/tmp/s; for f in "$S/a" $S/b; do rm "$f"; done', 'rm'),
    ).toEqual([
      [
        ['rm', true],
        ['/tmp/s/a', true],
      ],
      [
        ['rm', true],
        ['/tmp/s/b', true],
      ],
    ])
  })

  it('reads nested loops, a subshell and a cd in the body', () => {
    expect(
      argvs(
        'for k in a b; do for j in c d; do echo "$k$j"; done; ( cd "$k" && echo "$k" ); done',
      ),
    ).toEqual([
      ['echo', 'ac'],
      ['echo', 'ad'],
      ['cd', 'a'],
      ['echo', 'a'],
      ['echo', 'bc'],
      ['echo', 'bd'],
      ['cd', 'b'],
      ['echo', 'b'],
    ])
    const moved = parse('for d in x y; do ( cd "$d" && git push ); done')
    expect(
      moved.commands
        .filter((command) => command.argv[0] === 'git')
        .map((command) => command.cwd),
    ).toEqual(['x', 'y'])
  })

  it('reads a loop inside if, and one written over lines', () => {
    expect(argvs('if true; then for k in a b; do echo $k; done; fi')).toEqual([
      ['true'],
      ['echo', 'a'],
      ['echo', 'b'],
    ])
    expect(argvs('for k in a b\ndo\n  echo $k\ndone')).toEqual([
      ['echo', 'a'],
      ['echo', 'b'],
    ])
  })

  it('carries into the body a variable the header’s && list assigned, unless the body assigns it', () => {
    const line = (body: string) =>
      `git fetch && S=/tmp/s && for n in 1 2; do ${body}; done`
    expect(
      parse(line('gh api x > "$S/a-$n.json"')).commands.map(
        (command) => command.redirs?.[0]?.target,
      ),
    ).toEqual([
      undefined,
      { value: '/tmp/s/a-1.json', known: true },
      { value: '/tmp/s/a-2.json', known: true },
    ])
    for (const body of ['S=/y; cp a "$S/$n"', 'cp a "$S/$n"; S=/y'])
      expect(each(line(body), 'cp').map((words) => words[2])).toEqual([
        ['$S/$n', false],
        ['$S/$n', false],
      ])
  })

  it('binds the variable when the body only hands NAME=… to a program', () => {
    expect(argvs('for n in 12 13; do gh api graphql -F n=$n; done')).toEqual([
      ['gh', 'api', 'graphql', '-F', 'n=12'],
      ['gh', 'api', 'graphql', '-F', 'n=13'],
    ])
  })

  it('leaves the variable unknown after the loop', () => {
    expect(each('for k in a b; do :; done; echo $k', 'echo')).toEqual([
      [
        ['echo', true],
        ['$k', false],
      ],
    ])
  })

  it.each([
    ['a glob', 'for k in *.md; do echo "$k"; done'],
    ['a brace expansion', 'for k in {a,b}; do echo "$k"; done'],
    ['a value with a blank', 'for k in a "b c"; do echo "$k"; done'],
    ["zsh's ~ glob operator", 'for k in a~b; do echo "$k"; done'],
    ["zsh's leading =", 'for k in =ls; do echo "$k"; done'],
    ['a value behind an expansion', 'for k in a "$L"; do echo "$k"; done'],
    ['a value from a substitution', 'for k in $(ls); do echo "$k"; done'],
    [
      'a value from a heredoc read',
      `for k in "$(cat <<'E'\na\nE\n)"; do echo "$k"; done`,
    ],
    ['no list', 'for k; do echo "$k"; done'],
    ['a body that reassigns it', 'for k in a b; do k=z; echo "$k"; done'],
    ['a body that reads it', 'for k in a b; do read k; echo "$k"; done'],
    ['a body that exports it', 'for k in a b; do export k=z; echo "$k"; done'],
    [
      'a body that declares it through command',
      'for k in a b; do command declare k=z; echo "$k"; done',
    ],
    [
      'an assignment before a command in the body',
      'for k in a b; do k=z true; echo "$k"; done',
    ],
    [
      'a body command whose name it cannot read',
      'for k in a b; do "$C" k=z; echo "$k"; done',
    ],
    [
      'a body that opens a descriptor into it',
      'for k in a b; do exec {k}>saida; echo "$k"; done',
    ],
    [
      'a nested loop over the same name',
      'for k in a; do for k in b; do :; done; echo "$k"; done',
    ],
    [
      'a function the body defines',
      'for k in a; do f() { :; }; echo "$k"; done',
    ],
    ['an eval in the body', 'for k in a; do eval "$X"; echo "$k"; done'],
    ['a name the shell changes', 'for RANDOM in a; do echo "$RANDOM"; done'],
    ['IFS as the name', 'for IFS in a; do echo "$IFS"; done'],
    ['no done closing it', '{ for k in a b; echo "$k"; }'],
    ['an empty list', 'for k in; do echo "$k"; done'],
  ])('reads the body once, the variable unknown, with %s', (_, text) => {
    const echoes = each(text, 'echo')
    expect(echoes).toHaveLength(1)
    expect(echoes[0][1][1]).toBe(false)
  })

  it('reads a loop past the limit once, its variable unknown', () => {
    const values = Array.from({ length: 600 }, (_, k) => k).join(' ')
    expect(each(`for n in ${values}; do echo $n; done`, 'echo')).toEqual([
      [
        ['echo', true],
        ['$n', false],
      ],
    ])
  })
})

// ---------------------------------------------------------------------------
// Seventh round of Copilot's review of #26

describe('standalone assignments before a command (Copilot review of #26, seventh round)', () => {
  it('carries them to the next command, not enumerable, and only once', () => {
    const parsed = parse('HOME=/x A=1; gh issue view 5; gh pr view')
    const [first, second] = parsed.commands
    expect(first.argv).toEqual(['gh', 'issue', 'view', '5'])
    expect(first.assignedBefore?.map((entry) => entry.name)).toEqual([
      'HOME',
      'A',
    ])
    expect(Object.keys(first)).not.toContain('assignedBefore')
    expect(second.assignedBefore).toBeUndefined()
  })

  it('does not count an assignment on the command itself', () => {
    const [command] = parse('HOME=/x gh issue view 5').commands
    expect(command.env).toEqual({ HOME: '/x' })
    expect(command.assignedBefore).toBeUndefined()
  })

  it('keeps a watched variable so assigned as unknown, and leaves the others', () => {
    const exported: Record<string, string> = {}
    for (const command of parse('HOME=/x; A=1; GH_REPO=a/b; gh issue view 5')
      .commands)
      shell.recordAssignments(command, exported)
    expect(exported).toEqual({
      HOME: '${ATRIBUIDO}',
      GH_REPO: '${ATRIBUIDO}',
    })
  })

  it('keeps a watched variable a declaring builtin sets in place as unknown, and exports as they are', () => {
    const exported: Record<string, string> = {}
    for (const text of [
      'declare HOME=/x',
      'readonly XDG_CONFIG_HOME=/y',
      'export GIT_CONFIG_GLOBAL=/z',
      'declare -x GIT_CONFIG_COUNT=1',
    ])
      for (const command of parse(text).commands)
        shell.recordExports(command, exported)
    expect(exported).toEqual({
      HOME: '${ATRIBUIDO}',
      XDG_CONFIG_HOME: '${ATRIBUIDO}',
      GIT_CONFIG_GLOBAL: '/z',
      GIT_CONFIG_COUNT: '1',
    })
  })
})

describe('what env takes out of a command’s environment (Copilot review of #26, seventh round)', () => {
  it('reads a lone - as -i, instead of as the program', () => {
    const [command] = parse('env - gh issue reopen 5').commands
    expect(command.argv).toEqual(['gh', 'issue', 'reopen', '5'])
    expect(command.env).toEqual(clearedByEnvI)
    expect(parse('env -i gh issue reopen 5').commands[0].env).toEqual(
      clearedByEnvI,
    )
    expect(
      parse('env --ignore-environment HOME=/x gh issue reopen 5').commands[0]
        .env,
    ).toEqual({ ...clearedByEnvI, HOME: '/x' })
  })

  it('writes a watched variable env -u takes out as empty, and leaves the others', () => {
    for (const text of [
      'env -u HOME -u X gh issue view 5',
      'env -uHOME gh issue view 5',
      'env --unset=HOME gh issue view 5',
      'env --unset HOME gh issue view 5',
    ])
      expect(parse(text).commands[0]).toMatchObject({
        argv: ['gh', 'issue', 'view', '5'],
        env: { HOME: '' },
      })
    expect(parse('env -u X gh issue view 5').commands[0].env).toEqual({})
  })
})
