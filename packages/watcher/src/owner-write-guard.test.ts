import { describe, expect, it } from 'bun:test'
import { ownerWrite, verdict } from './owner-write-guard'

const refused = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) === null)
const allowed = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) !== null)

describe('ownerWrite (#368)', () => {
  it('finds pr and issue writes through plain gh', () => {
    expect(refused([
      'gh pr comment 5 --body x',
      'gh issue comment 2136 -b x',
      'gh issue create -t title -b body',
      'gh issue edit 3 --add-label question',
      'gh issue close 3',
      'gh issue reopen 3',
      'gh issue delete 3 --yes',
      'gh pr create --draft --fill',
      'gh pr edit 1 --body x',
      'gh pr close 1',
      'gh pr reopen 1',
      'gh pr merge 1 --squash',
      'gh pr review 1 --approve',
      'gh pr ready 1',
      'gh -R Flixbox/household-brain issue close 1',
      'gh pr --repo Flixbox/household-brain comment 1 -b x',
    ])).toEqual([])
  })

  it('finds label writes', () => {
    expect(refused(['gh label create bug', 'gh label edit bug --color f00', 'gh label delete bug --yes'])).toEqual([])
  })

  it('finds api calls that write', () => {
    expect(refused([
      'gh api -X POST repos/o/r/issues/1/comments -f body=x',
      'gh api --method PATCH repos/o/r/issues/1 -f state=closed',
      'gh api --method=put repos/o/r/pulls/1/merge',
      'gh api -XDELETE repos/o/r/labels/bug',
      'gh api repos/o/r/issues/1/comments -f body=x',
      'gh api repos/o/r/issues/1/comments -fbody=x',
      'gh api repos/o/r/issues/1/comments -F body=@note.md',
      'gh api repos/o/r/issues/1/comments --field=body=x',
      'gh api repos/o/r/issues/1/comments --raw-field body=x',
      'gh api repos/o/r/issues/1/comments --input body.json',
      "gh api graphql -f query='mutation { addComment(input: {}) { clientMutationId } }'",
      'gh api graphql -F query=@mutation.graphql',
    ])).toEqual([])
  })

  it('finds gh anywhere in a pipeline, list, subshell or substitution', () => {
    expect(refused([
      'agent-gh issue comment 1 -b x || gh issue comment 1 -b x',
      'echo x | gh issue comment 1 -F -',
      'cd repo && GH_REPO=o/r gh pr comment 1 -b x',
      'true; gh pr close 1',
      'gh pr close 1 &',
      'false\ngh pr close 1',
      '(gh pr close 1)',
      '{ gh pr close 1; }',
      'out=$(gh pr comment 1 -b x)',
      'echo "$(gh issue close 1)"',
      'echo `gh issue close 1`',
      "bash -c 'gh pr comment 1 -b x'",
      "sh -lc 'gh pr comment 1 -b x'",
      'env GH_REPO=o/r gh issue close 1',
      'timeout 30 gh issue close 1',
      '/usr/bin/gh pr close 1',
      'gh pr comment 1 \\\n  --body x',
    ])).toEqual([])
  })

  it('finds gh behind wrappers whose options take values, and after redirections (Codex on #369)', () => {
    expect(refused([
      'sudo -u someone gh issue close 1',
      'env -u NAME gh issue close 1',
      'nice -n 10 gh pr close 1',
      'timeout -s KILL 30 gh pr close 1',
      "sudo -u someone bash -c 'gh pr close 1'",
      '>out gh issue close 1',
      '> out gh issue close 1',
      '2>/dev/null gh issue close 1',
      'GH_REPO=o/r 2>&1 gh issue close 1',
    ])).toEqual([])
  })

  it('finds gh in a substitution with quoted parentheses (Codex on #369)', () => {
    expect(refused([
      "echo \"$(printf ')'; gh issue close 1)\"",
      "x=$(echo ')' && gh issue close 1)",
    ])).toEqual([])
  })

  it('counts what the shell fills in as a write (Codex on #369)', () => {
    expect(refused([
      'gh api repos/o/r/issues/1 --method "$METHOD"',
      'gh api -X $METHOD repos/o/r/issues/1',
      'gh api -X OPTIONS repos/o/r',
      'gh api graphql -f query="$(cat mutation.graphql)"',
      'gh api graphql -f query=`cat mutation.graphql`',
      'gh api graphql -f "query=$QUERY"',
      'gh api graphql -F owner=o',
      'gh api -iX POST repos/o/r/issues/1/comments',
      '"$GH" pr comment 1 -b x',
      'gh pr "$ACTION" 1',
      'gh $GROUP close 1',
    ])).toEqual([])
  })

  it('reads a GraphQL operation, not the strings and comments in it (Codex on #369)', () => {
    expect(allowed([
      "gh api graphql -f query='{ search(query: \"mutation\", type: ISSUE, first: 1) { issueCount } }'",
      "gh api graphql -f query='# no mutation here\n{ viewer { login } }'",
      "gh api graphql -f query='{ viewer { login } }' -f q=mutation",
    ])).toEqual([])
    expect(refused(["gh api graphql -f query='# a comment\nmutation { x }'"])).toEqual([])
  })

  it('lets gh read with what the shell fills in where it decides nothing', () => {
    expect(allowed([
      'gh api "repos/$REPO/pulls"',
      'gh pr view "$N" --comments',
      'gh api -X GET "repos/$REPO/issues" -f q=x',
      'gh api --method HEAD repos/o/r',
      'echo "$(gh pr view 1)"',
      'timeout 30 gh pr view 1',
      'sudo -u someone gh pr view 1',
      '2>/dev/null gh pr view 1',
      '$PAGER file.txt',
    ])).toEqual([])
  })

  it('names the command it found', () => {
    expect(ownerWrite('cd repo && gh pr comment 1 -b "a b" | cat')).toBe('gh pr comment 1 -b a b')
    expect(ownerWrite('gh api x --method "$METHOD"')).toBe('gh api x --method $METHOD')
  })

  it('lets agent-gh write', () => {
    expect(allowed([
      'agent-gh pr comment 1 -b x',
      'agent-gh api -X POST repos/o/r/issues/1/comments -f body=x',
      '~/.local/bin/agent-gh issue close 1',
      '/home/someone/.local/bin/agent-gh pr merge 1',
      'agent-gh.exe issue close 1',
    ])).toEqual([])
  })

  it('lets gh read', () => {
    expect(allowed([
      'gh pr view 1',
      'gh pr view 1 --comments',
      'gh pr list --state all',
      'gh pr checks 1',
      'gh pr diff 1',
      'gh pr status',
      'gh issue view 368',
      'gh issue list --label question',
      'gh label list',
      'gh run view 123 --log',
      'gh run list --workflow ci.yml',
      'gh api repos/o/r/pulls',
      'gh api -X GET search/issues -f q=is:open',
      'gh api --method get repos/o/r/issues -F per_page=100',
      "gh api graphql -f query='{ viewer { login } }'",
      "gh api graphql -f query='query($n: Int!) { viewer { login } }' -F n=1",
      'gh auth status',
      'gh --version',
    ])).toEqual([])
  })

  it('reads only the word in command position', () => {
    expect(allowed([
      'echo "gh pr comment 1"',
      "git commit -m 'gh pr close 1'",
      'grep -n "gh issue close" AGENTS.md',
      'agent-gh pr create --body "run gh pr comment 1 to say so"',
      '# gh pr close 1',
      'echo hi # gh pr close 1',
      'ls ~/.config/gh',
    ])).toEqual([])
  })
})

describe('verdict, the hook\'s answer (#368)', () => {
  const call = (command: string) => ({ hook_event_name: 'PreToolUse', tool_input: { command }, tool_name: 'Bash' })

  it('denies a write through plain gh, naming agent-gh', () => {
    const answer = verdict(call('gh issue comment 1 -b x'))
    expect(answer?.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(answer?.hookSpecificOutput.permissionDecisionReason).toContain('`gh issue comment 1 -b x`')
    expect(answer?.hookSpecificOutput.permissionDecisionReason).toContain('agent-gh')
  })

  it('lets anything else run', () => {
    expect(verdict(call('agent-gh issue comment 1 -b x'))).toBeNull()
    expect(verdict(call('gh pr view 1'))).toBeNull()
    expect(verdict({ tool_input: {}, tool_name: 'Bash' })).toBeNull()
    expect(verdict(null)).toBeNull()
  })
})
