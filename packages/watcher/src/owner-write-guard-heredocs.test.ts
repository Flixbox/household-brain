import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

const refused = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) === null)
const allowed = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) !== null)

describe('ownerWrite, on here-documents and here-strings (#382)', () => {
  it('reads what a here-document or here-string feeds a shell as commands (#382)', () => {
    expect(refused([
      "bash <<'EOF'\ngh issue close 1\nEOF",
      'bash <<EOF\ngh issue close 1\nEOF',
      'bash -s <<EOF\ngh issue close 1\nEOF',
      "sh <<'EOF'\ngh issue close 1\nEOF",
      "zsh <<'EOF'\ngh issue close 1\nEOF",
      "dash <<-'EOF'\n\tgh issue close 1\n\tEOF",
      "/bin/bash <<'EOF'\ngh issue close 1\nEOF",
      "<<'EOF' bash\ngh issue close 1\nEOF",
      "env FOO=1 bash <<'EOF'\ngh issue close 1\nEOF",
      "sudo -u someone bash <<'EOF'\ngh issue close 1\nEOF",
      "timeout 30 bash <<'EOF'\necho hi\ngh issue close 1\nEOF",
      "bash -c 'bash <<EOF\ngh issue close 1\nEOF\n'",
      "bash -c bash <<'EOF'\ngh issue close 1\nEOF",
      "bash <<'EOF'\nbash <<'IN'\ngh issue close 1\nIN\nEOF",
      "bash <<'EOF'\n$SCRIPT\nEOF",
      'bash <<< "gh issue close 1"',
      "bash <<<'gh issue close 1'",
      'sudo bash <<< "gh issue close 1"',
      'bash <<< "$SCRIPT"',
      'source /dev/stdin <<< "gh issue close 1"',
      ". /dev/stdin <<'EOF'\ngh issue close 1\nEOF",
      '"$SH" -s <<< "gh issue close 1"',
    ])).toEqual([])
  })

  it('takes one level of escapes off an unquoted body before the shell reads it (#382)', () => {
    expect(refused([
      'bash <<EOF\necho "\\$(gh issue close 1)"\nEOF',
      'bash <<EOF\necho "\\`gh issue close 1\\`"\nEOF',
    ])).toEqual([])
    expect(allowed(["bash <<'EOF'\necho \"\\$(gh issue close 1)\"\nEOF"])).toEqual([])
  })

  it('reads a here-document as commands when anything on the line may hand it to a shell (#382)', () => {
    expect(refused([
      "cat <<'EOF' | bash\ngh issue close 1\nEOF",
      "cat <<'EOF' | tee copy | sudo sh\ngh issue close 1\nEOF",
      "{ bash; } <<'EOF'\ngh issue close 1\nEOF",
      "(bash) <<'EOF'\ngh issue close 1\nEOF",
      'cat <<< "gh issue close 1" | bash',
    ])).toEqual([])
  })

  it('reads a here-string as one word, so the lines after it still run (#382)', () => {
    expect(refused([
      'cat <<<x\ngh issue close 1',
      'cat <<< x\ngh issue close 1\nx',
    ])).toEqual([])
  })

  it('counts input to a shell that the shell expands first as a write (Codex on #383)', () => {
    expect(refused([
      'bash <<< "echo $SCRIPT"',
      'bash <<EOF\necho $SCRIPT\nEOF',
      'bash <<EOF\necho `cat x`\nEOF',
      'cat <<EOF | bash\necho $SCRIPT\nEOF',
    ])).toEqual([])
    expect(allowed([
      "bash <<< 'echo $SCRIPT'",
      "bash <<'EOF'\necho $SCRIPT\nEOF",
      'bash <<EOF\necho \\$SCRIPT\nEOF',
      'cat <<EOF\necho $SCRIPT\nEOF',
    ])).toEqual([])
  })

  it('knows busybox and the other shells (Codex on #383)', () => {
    expect(refused([
      "busybox sh <<'EOF'\ngh issue close 1\nEOF",
      "busybox sh -c 'gh issue close 1'",
      "ash <<'EOF'\ngh issue close 1\nEOF",
      "ksh <<'EOF'\ngh issue close 1\nEOF",
      "fish <<'EOF'\ngh issue close 1\nEOF",
      "mksh <<'EOF'\ngh issue close 1\nEOF",
      "yash <<'EOF'\ngh issue close 1\nEOF",
      "tcsh <<'EOF'\ngh issue close 1\nEOF",
      "bash-5.2 <<'EOF'\ngh issue close 1\nEOF",
      "bash.exe <<'EOF'\ngh issue close 1\nEOF",
      "mksh -c 'gh issue close 1'",
    ])).toEqual([])
  })

  it('takes an empty here-string as a word of its own, so the command after it stays in command position (review on #383)', () => {
    expect(refused([
      "<<<'' gh issue close 1",
      "<<< '' gh issue close 1",
      '<<< x gh issue close 1',
      '<<<"" gh issue close 1',
      "0<<<'' gh issue close 1",
      "FOO=1 <<<'' gh issue close 1",
      "<<<'' bash -c 'gh issue close 1'",
      "<<<'' bash <<'EOF'\ngh issue close 1\nEOF",
    ])).toEqual([])
    expect(allowed(["<<<'' cat", "<<<'' gh pr view 1"])).toEqual([])
  })

  it('takes the tabs off a <<- body before a shell reads it (review on #383)', () => {
    expect(refused([
      'bash <<-E\ngh\\\n\tissue close 1\nE',
      // Shells differ on whether tabs or the line continuation go first, so this form fails closed.
      'bash <<-E\ng\\\n\th issue close 1\nE',
      "bash <<-'E'\n\tcat <<'I'\n\tdata\n\tI\n\tgh issue close 1\nE",
      'sh <<-E\n\tcat <<I\n\tI\n\tgh issue close 1\nE',
    ])).toEqual([])
  })

  it('counts a shell started through eval or env -S as reading the here-document (review on #383)', () => {
    expect(refused([
      "eval 'bash -s' <<'EOF'\ngh issue close 1\nEOF",
      "eval bash <<< 'gh issue close 1'",
      "eval bash <<'EOF'\ngh issue close 1\nEOF",
      "cat <<'EOF' | eval bash\ngh issue close 1\nEOF",
      "eval cat '|' bash <<'EOF'\ngh issue close 1\nEOF",
      "env -S 'bash -s' <<'EOF'\ngh issue close 1\nEOF",
      "env --split-string='bash -s' <<< 'gh issue close 1'",
    ])).toEqual([])
  })

  it('leaves what no shell reads as data (#382)', () => {
    expect(allowed([
      "bash <<'EOF'\ngh pr view 1\nagent-gh issue close 1\nEOF",
      'cat <<< "gh issue close 1"',
      'grep gh <<< "gh issue close 1"',
      "agent-gh issue comment 1 --body-file - <<< 'gh pr close 1'",
      "cat <<'EOF' | grep gh\ngh issue close 1\nEOF",
      "bash <<'EOF'\ncat <<'IN'\ngh issue close 1\nIN\nEOF",
    ])).toEqual([])
  })
})
