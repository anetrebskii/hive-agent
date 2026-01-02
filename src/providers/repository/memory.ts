/**
 * Memory Repository Provider
 *
 * In-memory storage implementation. Useful for testing and development.
 * Data is lost when the process exits.
 */

import type { RepositoryProvider, Message } from '../../types.js'

interface CacheEntry {
  value: unknown
  expiresAt?: number
}

export class MemoryRepository implements RepositoryProvider {
  private history: Map<string, Message[]> = new Map()
  private state: Map<string, Record<string, unknown>> = new Map()
  private cache: Map<string, CacheEntry> = new Map()

  async getHistory(conversationId: string): Promise<Message[]> {
    return this.history.get(conversationId) || []
  }

  async saveHistory(conversationId: string, messages: Message[]): Promise<void> {
    this.history.set(conversationId, [...messages])
  }

  async getState(conversationId: string): Promise<Record<string, unknown> | null> {
    return this.state.get(conversationId) || null
  }

  async saveState(conversationId: string, state: Record<string, unknown>): Promise<void> {
    this.state.set(conversationId, { ...state })
  }

  async getCached(key: string): Promise<unknown | null> {
    const entry = this.cache.get(key)
    if (!entry) return null

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return entry.value
  }

  async setCached(key: string, value: unknown, ttlMs?: number): Promise<void> {
    const entry: CacheEntry = { value }
    if (ttlMs) {
      entry.expiresAt = Date.now() + ttlMs
    }
    this.cache.set(key, entry)
  }

  // Utility methods for testing
  clear(): void {
    this.history.clear()
    this.state.clear()
    this.cache.clear()
  }

  getConversationIds(): string[] {
    return Array.from(this.history.keys())
  }
}
