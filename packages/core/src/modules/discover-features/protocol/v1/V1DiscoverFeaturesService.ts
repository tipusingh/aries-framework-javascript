import type { AgentMessage } from '../../../../agent/AgentMessage'
import type { InboundMessageContext } from '../../../../agent/models/InboundMessageContext'
import type {
  DiscoverFeaturesDisclosureReceivedEvent,
  DiscoverFeaturesQueryReceivedEvent,
} from '../../DiscoverFeaturesEvents'
import type {
  CreateDisclosureOptions,
  CreateQueryOptions,
  DiscoverFeaturesProtocolMsgReturnType,
} from '../../DiscoverFeaturesServiceOptions'

import { Dispatcher } from '../../../../agent/Dispatcher'
import { EventEmitter } from '../../../../agent/EventEmitter'
import { FeatureRegistry } from '../../../../agent/FeatureRegistry'
import { Protocol } from '../../../../agent/models'
import { InjectionSymbols } from '../../../../constants'
import { AriesFrameworkError } from '../../../../error'
import { Logger } from '../../../../logger'
import { inject, injectable } from '../../../../plugins'
import { DiscoverFeaturesEventTypes } from '../../DiscoverFeaturesEvents'
import { DiscoverFeaturesModuleConfig } from '../../DiscoverFeaturesModuleConfig'
import { DiscoverFeaturesService } from '../../services'

import { V1DiscloseMessageHandler, V1QueryMessageHandler } from './handlers'
import { V1QueryMessage, V1DiscloseMessage, DiscloseProtocol } from './messages'

@injectable()
export class V1DiscoverFeaturesService extends DiscoverFeaturesService {
  public constructor(
    featureRegistry: FeatureRegistry,
    eventEmitter: EventEmitter,
    dispatcher: Dispatcher,
    @inject(InjectionSymbols.Logger) logger: Logger,
    discoverFeaturesConfig: DiscoverFeaturesModuleConfig
  ) {
    super(featureRegistry, eventEmitter, dispatcher, logger, discoverFeaturesConfig)

    this.registerHandlers(dispatcher)
  }

  /**
   * The version of the discover features protocol this service supports
   */
  public readonly version = 'v1'

  private registerHandlers(dispatcher: Dispatcher) {
    dispatcher.registerHandler(new V1DiscloseMessageHandler(this))
    dispatcher.registerHandler(new V1QueryMessageHandler(this))
  }

  public async createQuery(
    options: CreateQueryOptions
  ): Promise<DiscoverFeaturesProtocolMsgReturnType<V1QueryMessage>> {
    if (options.queries.length > 1) {
      throw new AriesFrameworkError('Discover Features V1 only supports a single query')
    }

    if (options.queries[0].featureType !== 'protocol') {
      throw new AriesFrameworkError('Discover Features V1 only supports querying for protocol support')
    }

    const queryMessage = new V1QueryMessage({
      query: options.queries[0].match,
      comment: options.comment,
    })

    return { message: queryMessage }
  }

  public async processQuery(
    messageContext: InboundMessageContext<V1QueryMessage>
  ): Promise<DiscoverFeaturesProtocolMsgReturnType<AgentMessage> | void> {
    const { query, threadId } = messageContext.message

    const connection = messageContext.assertReadyConnection()

    this.eventEmitter.emit<DiscoverFeaturesQueryReceivedEvent>(messageContext.agentContext, {
      type: DiscoverFeaturesEventTypes.QueryReceived,
      payload: {
        message: messageContext.message,
        connection,
        queries: [{ featureType: 'protocol', match: query }],
        protocolVersion: this.version,
        threadId,
      },
    })

    // Process query and send responde automatically if configured to do so, otherwise
    // just send the event and let controller decide
    if (this.discoverFeaturesModuleConfig.autoAcceptQueries) {
      return await this.createDisclosure({
        threadId,
        disclosureQueries: [{ featureType: 'protocol', match: query }],
      })
    }
  }

  public async createDisclosure(
    options: CreateDisclosureOptions
  ): Promise<DiscoverFeaturesProtocolMsgReturnType<V1DiscloseMessage>> {
    if (options.disclosureQueries.some((item) => item.featureType !== 'protocol')) {
      throw new AriesFrameworkError('Discover Features V1 only supports protocols')
    }

    if (!options.threadId) {
      throw new AriesFrameworkError('Thread Id is required for Discover Features V1 disclosure')
    }

    const matches = this.featureRegistry.query(...options.disclosureQueries)

    const discloseMessage = new V1DiscloseMessage({
      threadId: options.threadId,
      protocols: matches.map(
        (item) =>
          new DiscloseProtocol({
            protocolId: (item as Protocol).id,
            roles: (item as Protocol).roles,
          })
      ),
    })

    return { message: discloseMessage }
  }

  public async processDisclosure(messageContext: InboundMessageContext<V1DiscloseMessage>): Promise<void> {
    const { protocols, threadId } = messageContext.message

    const connection = messageContext.assertReadyConnection()

    this.eventEmitter.emit<DiscoverFeaturesDisclosureReceivedEvent>(messageContext.agentContext, {
      type: DiscoverFeaturesEventTypes.DisclosureReceived,
      payload: {
        message: messageContext.message,
        connection,
        disclosures: protocols.map((item) => new Protocol({ id: item.protocolId, roles: item.roles })),
        protocolVersion: this.version,
        threadId,
      },
    })
  }
}
