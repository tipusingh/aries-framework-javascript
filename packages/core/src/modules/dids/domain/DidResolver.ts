import type { AgentContext } from '../../../agent'
import type { ParsedDid, DidResolutionResult, DidResolutionOptions } from '../types'

export const DidResolverToken = Symbol('DidResolver')

export interface DidResolver {
  readonly supportedMethods: string[]
  resolve(
    agentContext: AgentContext,
    did: string,
    parsed: ParsedDid,
    didResolutionOptions: DidResolutionOptions
  ): Promise<DidResolutionResult>
}
