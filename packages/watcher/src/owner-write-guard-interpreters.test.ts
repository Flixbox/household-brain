import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

const refused = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) === null)
const allowed = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) !== null)

describe('ownerWrite, on programs interpreters and make run (#394)', () => {
  it('refuses a gh write in an inline program', () => {
    expect(refused([
      String.raw`python3 -c 'import os; os.system("gh issue close 1")'`,
      String.raw`python3 -Ic 'import os; os.system("gh issue close 1")'`,
      String.raw`python -c "import subprocess; subprocess.run(['gh', 'pr', 'merge', '1'])"`,
      String.raw`perl -e 'system("gh", "issue", "close", "1")'`,
      'perl -e \'`gh issue close 1`\'',
      String.raw`ruby -e 'system("gh pr comment 1 -b hi")'`,
      String.raw`node -e 'require("child_process").execSync("gh issue close 1")'`,
      String.raw`node --eval='require("child_process").execSync("gh issue close 1")'`,
      String.raw`awk 'BEGIN { system("gh issue close 1") }'`,
      String.raw`gawk -v x=1 'BEGIN { system("gh issue close 1") }'`,
      String.raw`sudo python3 -c 'import os; os.system("/usr/bin/gh issue close 1")'`,
      String.raw`bash -c "python3 -c 'import os; os.system(\"gh issue close 1\")'"`,
      String.raw`python3 -c 'import os; os.system("cd x && gh issue close 1")'`,
      String.raw`python3 -c 'import os; os.system("gh api repos/o/r/issues -f title=x")'`,
      'python3 -c \'run(["gh", "api", "repos/o/r", "-X",\n "DELETE"])\'',
      'python3 -c \'run([\n"gh",\n"issue",\n"close",\n"1",\n])\'',
    ])).toEqual([])
  })

  it('refuses a gh write in a program fed on input', () => {
    expect(refused([
      "python3 <<'EOF'\nimport os; os.system(\"gh issue close 1\")\nEOF",
      "python3 -I - <<'EOF'\nimport os; os.system(\"gh issue close 1\")\nEOF",
      'python3 <<EOF\nimport os; os.system("gh issue close 1")\nEOF',
      "perl <<'EOF'\nsystem('gh issue close 1');\nEOF",
      "ruby <<'EOF'\nsystem('gh issue close 1')\nEOF",
      "node <<'EOF'\nexecSync('gh issue close 1')\nEOF",
      String.raw`python3 <<< 'import os; os.system("gh issue close 1")'`,
      "awk -f - <<'EOF'\nBEGIN { system(\"gh issue close 1\") }\nEOF",
      "make -f - <<'EOF'\nall:\n\tgh issue close 1\nEOF",
      "make -f- <<'EOF'\nall:\n\tgh issue close 1\nEOF",
      "gmake --file=- <<'EOF'\nall:\n\tgh issue close 1\nEOF",
      "make -f /dev/stdin <<'EOF'\nall:\n\tgh issue close 1\nEOF",
      "cat <<'EOF' | python3\nimport os; os.system(\"gh issue close 1\")\nEOF",
    ])).toEqual([])
  })

  it('leaves programs that only read through gh, or write through agent-gh', () => {
    expect(allowed([
      String.raw`python3 -c 'import os; os.system("gh pr view 1")'`,
      String.raw`python3 -c 'import subprocess; subprocess.run(["gh", "issue", "list", "-R", "o/r"])'`,
      String.raw`python3 -c 'import os; os.system("gh api repos/o/r/pulls")'`,
      String.raw`python3 -c 'import os; os.system("agent-gh issue close 1")'`,
      "python3 <<'EOF'\nimport os; os.system(\"agent-gh issue close 1\")\nos.system(\"gh pr list\")\nEOF",
      "make -f - <<'EOF'\nall:\n\tagent-gh issue close 1\nEOF",
    ])).toEqual([])
  })

  it('leaves text that merely mentions gh', () => {
    expect(allowed([
      String.raw`python3 -c 'print("the gh login is the owner")'`,
      String.raw`python3 -I -c 'print("calling gh api graphql")'`,
      String.raw`python3 -c 'print("gh")'`,
      "python3 -I <<'EOF'\n# gh issue view reads; gh is the owner's login\nprint('sigh issue close')\nEOF",
      String.raw`awk '/high/ { print }' notes.txt`,
    ])).toEqual([])
  })

  it('leaves input a program only reads as data', () => {
    expect(allowed([
      "python3 -I tool.py <<'EOF'\ngh issue close 1\nEOF",
      "python3 -c 'print(1)' <<'EOF'\ngh issue close 1\nEOF",
      "perl tool.pl <<< 'gh issue close 1'",
      "node tool.js <<'EOF'\ngh issue close 1\nEOF",
      "awk '{ print }' <<'EOF'\ngh issue close 1\nEOF",
      "make <<'EOF'\ngh issue close 1\nEOF",
      "make -f Makefile <<'EOF'\ngh issue close 1\nEOF",
      "python3 tool.py -c 'gh is the login'",
      "python3 tool.py - <<'EOF'\ngh issue close 1\nEOF",
      "awk '{ print }' - <<'EOF'\ngh issue close 1\nEOF",
    ])).toEqual([])
  })
})
