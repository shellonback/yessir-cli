import { PolicyEngine } from '../policy/engine';
import { findPolicyFile, loadPolicy, DEFAULT_POLICY } from '../policy/loader';
import type { Policy, Provider } from '../types';

export interface ExplainOptions {
  cwd: string;
  command: string;
  provider?: Provider;
  policyPath?: string;
}

export interface ExplainResult {
  policyPath: string | null;
  policy: Policy;
  decision: ReturnType<PolicyEngine['evaluate']>;
}

export function runExplain(opts: ExplainOptions): ExplainResult {
  let policyPath: string | null = opts.policyPath ?? findPolicyFile(opts.cwd);
  let policy: Policy = DEFAULT_POLICY;
  if (policyPath) {
    policy = loadPolicy(policyPath);
  }
  const engine = new PolicyEngine(policy);
  const decision = engine.evaluate(
    {
      kind: 'command',
      raw: opts.command,
      command: opts.command,
      provider: opts.provider ?? 'claude'
    },
    { cwd: opts.cwd, provider: opts.provider ?? 'claude', mode: policy.mode }
  );
  return { policyPath, policy, decision };
}
