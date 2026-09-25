/**
 * @dsh-plugins/dsh-user-mirror TypeScript Definitions
 */

export const name: string
export const inject: string[]
export const Config: any
export const KINDS: {
	readonly PRINCIPLE: 'principle'
	readonly PREFERENCE: 'preference'
	readonly REDLINE: 'redline'
}

export type MemoryKind = 'principle' | 'preference' | 'redline'

export interface MemoryItem {
	id: string
	content: string
	kind: MemoryKind
	hitCount: number
	createdAt: number
	updatedAt: number
	lastSeenAt?: number
	reason?: string
}

export function normalize(text: string): string
export function strengthOf(p: MemoryItem, now?: number, halfLifeMs?: number): number
export function extractEntities(text: string): Set<string>
export function extractGrams(text: string, n?: number): Set<string>
export function extractKeywords(text: string): Set<string>
export function jaccard(setA: Set<string>, setB: Set<string>): number
export function findSimilar(table: MemoryItem[], text: string): MemoryItem | null
export function selectMemories(table: MemoryItem[], maxTokens?: number, now?: number, halfLifeMs?: number): MemoryItem[]
export function renderPreferences(table: MemoryItem[], maxTokens?: number, now?: number, halfLifeMs?: number): string
export function apply(ctx: any, config?: any): void

declare const _default: {
	name: string
	inject: string[]
	Config: any
	apply: typeof apply
}
export default _default
