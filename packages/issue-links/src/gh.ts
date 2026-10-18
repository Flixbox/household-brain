/** Asking GitHub through the `gh` CLI. GH: the `gh` to ask with (e.g. a bot's wrapper, GH=agent-gh); plain gh by default. */
const GH = process.env.GH ?? 'gh'

/** What a call answers, read as JSON (null for an empty answer); it fails with gh's own message. */
export const ghJson = async (args: string[]): Promise<unknown> => {
  const call = Bun.spawn([GH, ...args], { stderr: 'pipe', stdout: 'pipe', timeout: 60_000 })
  const [output, error, code] = await Promise.all([new Response(call.stdout).text(), new Response(call.stderr).text(), call.exited])
  if (code !== 0) {
    throw new Error(error.trim() || `${GH} ${args.join(' ')}: exit ${code}`)
  }
  return output.trim() === '' ? null : JSON.parse(output)
}
