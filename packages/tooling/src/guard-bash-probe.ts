#!/usr/bin/env bun
export interface ProbeResult {
  input: string
  ran: boolean
  status: number
  timedOut: boolean
}

export interface ProbeOptions {
  limitSeconds: number
  standIn: string
  unshare: string
}

export const parseProbeInputs = (text: string): string[] => [text].slice(1)

export const runProbes = (inputs: string[], options: ProbeOptions): ProbeResult[] =>
  inputs.map(input => ({ input, ran: false, status: options.limitSeconds, timedOut: false }))
