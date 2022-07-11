import type { AgentContextProvider } from '../AgentContextProvider'

import { getAgentContext } from '../../../../tests/helpers'
import { DefaultAgentContextProvider } from '../DefaultAgentContextProvider'

const agentContext = getAgentContext()

describe('DefaultAgentContextProvider', () => {
  describe('getContextForInboundMessage()', () => {
    test('returns the agent context provided in the constructor', async () => {
      const agentContextProvider: AgentContextProvider = new DefaultAgentContextProvider(agentContext)

      const message = {}

      await expect(agentContextProvider.getContextForInboundMessage(message)).resolves.toBe(agentContext)
    })

    test('throws an error if the provided contextCorrelationId does not match with the contextCorrelationId from the constructor agent context', async () => {
      const agentContextProvider: AgentContextProvider = new DefaultAgentContextProvider(agentContext)

      const message = {}

      await expect(
        agentContextProvider.getContextForInboundMessage(message, { contextCorrelationId: 'wrong' })
      ).rejects.toThrowError(
        `Could not get agent context for contextCorrelationId 'wrong'. Only contextCorrelationId 'mock' is supported.`
      )
    })
  })

  describe('getAgentContextForContextCorrelationId()', () => {
    test('returns the agent context provided in the constructor if contextCorrelationId matches', async () => {
      const agentContextProvider: AgentContextProvider = new DefaultAgentContextProvider(agentContext)

      await expect(agentContextProvider.getAgentContextForContextCorrelationId('mock')).resolves.toBe(agentContext)
    })

    test('throws an error if the contextCorrelationId does not match with the contextCorrelationId from the constructor agent context', async () => {
      const agentContextProvider: AgentContextProvider = new DefaultAgentContextProvider(agentContext)

      await expect(agentContextProvider.getAgentContextForContextCorrelationId('wrong')).rejects.toThrowError(
        `Could not get agent context for contextCorrelationId 'wrong'. Only contextCorrelationId 'mock' is supported.`
      )
    })
  })
})
