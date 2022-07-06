import type { AgentContext } from '../agent'
import type { IndyWallet } from '../wallet/IndyWallet'
import type { BaseRecord, TagsBase } from './BaseRecord'
import type { BaseRecordConstructor, Query, StorageService } from './StorageService'
import type { default as Indy, WalletQuery, WalletRecord, WalletSearchOptions } from 'indy-sdk'

import { AgentDependencies } from '../agent/AgentDependencies'
import { InjectionSymbols } from '../constants'
import { IndySdkError, RecordDuplicateError, RecordNotFoundError } from '../error'
import { injectable, inject } from '../plugins'
import { JsonTransformer } from '../utils/JsonTransformer'
import { isIndyError } from '../utils/indyError'
import { isBoolean } from '../utils/type'
import { assertIndyWallet } from '../wallet/util/assertIndyWallet'

@injectable()
export class IndyStorageService<T extends BaseRecord> implements StorageService<T> {
  private indy: typeof Indy

  private static DEFAULT_QUERY_OPTIONS = {
    retrieveType: true,
    retrieveTags: true,
  }

  public constructor(@inject(InjectionSymbols.AgentDependencies) agentDependencies: AgentDependencies) {
    this.indy = agentDependencies.indy
  }

  private transformToRecordTagValues(tags: { [key: number]: string | undefined }): TagsBase {
    const transformedTags: TagsBase = {}

    for (const [key, value] of Object.entries(tags)) {
      // If the value is a boolean string ('1' or '0')
      // use the boolean val
      if (value === '1' && key?.includes(':')) {
        const [tagName, tagValue] = key.split(':')

        const transformedValue = transformedTags[tagName]

        if (Array.isArray(transformedValue)) {
          transformedTags[tagName] = [...transformedValue, tagValue]
        } else {
          transformedTags[tagName] = [tagValue]
        }
      }
      // Transform '1' and '0' to boolean
      else if (value === '1' || value === '0') {
        transformedTags[key] = value === '1'
      }
      // If 1 or 0 is prefixed with 'n__' we need to remove it. This is to prevent
      // casting the value to a boolean
      else if (value === 'n__1' || value === 'n__0') {
        transformedTags[key] = value === 'n__1' ? '1' : '0'
      }
      // Otherwise just use the value
      else {
        transformedTags[key] = value
      }
    }

    return transformedTags
  }

  private transformFromRecordTagValues(tags: TagsBase): { [key: string]: string | undefined } {
    const transformedTags: { [key: string]: string | undefined } = {}

    for (const [key, value] of Object.entries(tags)) {
      // If the value is of type null we use the value undefined
      // Indy doesn't support null as a value
      if (value === null) {
        transformedTags[key] = undefined
      }
      // If the value is a boolean use the indy
      // '1' or '0' syntax
      else if (isBoolean(value)) {
        transformedTags[key] = value ? '1' : '0'
      }
      // If the value is 1 or 0, we need to add something to the value, otherwise
      // the next time we deserialize the tag values it will be converted to boolean
      else if (value === '1' || value === '0') {
        transformedTags[key] = `n__${value}`
      }
      // If the value is an array we create a tag for each array
      // item ("tagName:arrayItem" = "1")
      else if (Array.isArray(value)) {
        value.forEach((item) => {
          const tagName = `${key}:${item}`
          transformedTags[tagName] = '1'
        })
      }
      // Otherwise just use the value
      else {
        transformedTags[key] = value
      }
    }

    return transformedTags
  }

  /**
   * Transforms the search query into a wallet query compatible with indy WQL.
   *
   * The format used by AFJ is almost the same as the indy query, with the exception of
   * the encoding of values, however this is handled by the {@link IndyStorageService.transformToRecordTagValues}
   * method.
   */
  private indyQueryFromSearchQuery(query: Query<T>): Record<string, unknown> {
    // eslint-disable-next-line prefer-const
    let { $and, $or, $not, ...tags } = query

    $and = ($and as Query<T>[] | undefined)?.map((q) => this.indyQueryFromSearchQuery(q))
    $or = ($or as Query<T>[] | undefined)?.map((q) => this.indyQueryFromSearchQuery(q))
    $not = $not ? this.indyQueryFromSearchQuery($not as Query<T>) : undefined

    const indyQuery = {
      ...this.transformFromRecordTagValues(tags as unknown as TagsBase),
      $and,
      $or,
      $not,
    }

    return indyQuery
  }

  private recordToInstance(record: WalletRecord, recordClass: BaseRecordConstructor<T>): T {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const instance = JsonTransformer.deserialize<T>(record.value!, recordClass)
    instance.id = record.id

    const tags = record.tags ? this.transformToRecordTagValues(record.tags) : {}
    instance.replaceTags(tags)

    return instance
  }

  /** @inheritDoc */
  public async save(agentContext: AgentContext, record: T) {
    assertIndyWallet(agentContext.wallet)

    const value = JsonTransformer.serialize(record)
    const tags = this.transformFromRecordTagValues(record.getTags()) as Record<string, string>

    try {
      await this.indy.addWalletRecord(agentContext.wallet.handle, record.type, record.id, value, tags)
    } catch (error) {
      // Record already exists
      if (isIndyError(error, 'WalletItemAlreadyExists')) {
        throw new RecordDuplicateError(`Record with id ${record.id} already exists`, { recordType: record.type })
      }

      throw isIndyError(error) ? new IndySdkError(error) : error
    }
  }

  /** @inheritDoc */
  public async update(agentContext: AgentContext, record: T): Promise<void> {
    assertIndyWallet(agentContext.wallet)

    const value = JsonTransformer.serialize(record)
    const tags = this.transformFromRecordTagValues(record.getTags()) as Record<string, string>

    try {
      await this.indy.updateWalletRecordValue(agentContext.wallet.handle, record.type, record.id, value)
      await this.indy.updateWalletRecordTags(agentContext.wallet.handle, record.type, record.id, tags)
    } catch (error) {
      // Record does not exist
      if (isIndyError(error, 'WalletItemNotFound')) {
        throw new RecordNotFoundError(`record with id ${record.id} not found.`, {
          recordType: record.type,
          cause: error,
        })
      }

      throw isIndyError(error) ? new IndySdkError(error) : error
    }
  }

  /** @inheritDoc */
  public async delete(agentContext: AgentContext, record: T) {
    assertIndyWallet(agentContext.wallet)

    try {
      await this.indy.deleteWalletRecord(agentContext.wallet.handle, record.type, record.id)
    } catch (error) {
      // Record does not exist
      if (isIndyError(error, 'WalletItemNotFound')) {
        throw new RecordNotFoundError(`record with id ${record.id} not found.`, {
          recordType: record.type,
          cause: error,
        })
      }

      throw isIndyError(error) ? new IndySdkError(error) : error
    }
  }

  /** @inheritDoc */
  public async getById(agentContext: AgentContext, recordClass: BaseRecordConstructor<T>, id: string): Promise<T> {
    assertIndyWallet(agentContext.wallet)

    try {
      const record = await this.indy.getWalletRecord(
        agentContext.wallet.handle,
        recordClass.type,
        id,
        IndyStorageService.DEFAULT_QUERY_OPTIONS
      )
      return this.recordToInstance(record, recordClass)
    } catch (error) {
      if (isIndyError(error, 'WalletItemNotFound')) {
        throw new RecordNotFoundError(`record with id ${id} not found.`, {
          recordType: recordClass.type,
          cause: error,
        })
      }

      throw isIndyError(error) ? new IndySdkError(error) : error
    }
  }

  /** @inheritDoc */
  public async getAll(agentContext: AgentContext, recordClass: BaseRecordConstructor<T>): Promise<T[]> {
    assertIndyWallet(agentContext.wallet)

    const recordIterator = this.search(
      agentContext.wallet,
      recordClass.type,
      {},
      IndyStorageService.DEFAULT_QUERY_OPTIONS
    )
    const records = []
    for await (const record of recordIterator) {
      records.push(this.recordToInstance(record, recordClass))
    }
    return records
  }

  /** @inheritDoc */
  public async findByQuery(
    agentContext: AgentContext,
    recordClass: BaseRecordConstructor<T>,
    query: Query<T>
  ): Promise<T[]> {
    assertIndyWallet(agentContext.wallet)

    const indyQuery = this.indyQueryFromSearchQuery(query)

    const recordIterator = this.search(
      agentContext.wallet,
      recordClass.type,
      indyQuery,
      IndyStorageService.DEFAULT_QUERY_OPTIONS
    )
    const records = []
    for await (const record of recordIterator) {
      records.push(this.recordToInstance(record, recordClass))
    }
    return records
  }

  private async *search(
    wallet: IndyWallet,
    type: string,
    query: WalletQuery,
    { limit = Infinity, ...options }: WalletSearchOptions & { limit?: number }
  ) {
    try {
      const searchHandle = await this.indy.openWalletSearch(wallet.handle, type, query, options)

      let records: Indy.WalletRecord[] = []

      // Allow max of 256 per fetch operation
      const chunk = limit ? Math.min(256, limit) : 256

      // Loop while limit not reached (or no limit specified)
      while (!limit || records.length < limit) {
        // Retrieve records
        const recordsJson = await this.indy.fetchWalletSearchNextRecords(wallet.handle, searchHandle, chunk)

        if (recordsJson.records) {
          records = [...records, ...recordsJson.records]

          for (const record of recordsJson.records) {
            yield record
          }
        }

        // If the number of records returned is less than chunk
        // It means we reached the end of the iterator (no more records)
        if (!records.length || !recordsJson.records || recordsJson.records.length < chunk) {
          await this.indy.closeWalletSearch(searchHandle)

          return
        }
      }
    } catch (error) {
      throw new IndySdkError(error, `Searching '${type}' records for query '${JSON.stringify(query)}' failed`)
    }
  }
}
