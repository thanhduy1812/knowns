/**
 * SQLite Search Engine
 * Combines semantic (vector cosine similarity) and keyword search using SQLite
 */

import type { EmbeddingService } from "./embedding";
import type { SearchStore } from "./store";
import type { Chunk, DocChunk, EmbeddingModel, TaskChunk } from "./types";
import { EMBEDDING_MODELS } from "./types";

/**
 * Search mode
 */
export type SearchMode = "hybrid" | "semantic" | "keyword";

/**
 * Search options
 */
export interface SearchOptions {
	/** Maximum number of results to return */
	limit?: number;
	/** Search mode (default: hybrid) */
	mode?: SearchMode;
	/** Filter by content type */
	type?: "doc" | "task" | "all";
	/** Minimum similarity threshold for semantic search (0-1) */
	similarity?: number;
	/** Weight for semantic results (0-1, default: 0.6) */
	semanticWeight?: number;
	/** Weight for keyword results (0-1, default: 0.4) */
	keywordWeight?: number;
}

/**
 * Search result item
 */
export interface SearchResult {
	/** Unique ID of the chunk */
	id: string;
	/** Content type */
	type: "doc" | "task";
	/** Relevance score (0-1) */
	score: number;
	/** Title (extracted from content or metadata) */
	title: string;
	/** Snippet of content */
	snippet: string;
	/** Document path (for docs) */
	path?: string;
	/** Task ID (for tasks) */
	taskId?: string;
	/** Metadata */
	metadata?: Record<string, unknown>;
	/** How this result was found */
	matchedBy: ("semantic" | "keyword")[];
}

/**
 * Search response
 */
export interface SearchResponse {
	/** Search results */
	results: SearchResult[];
	/** Total number of matches */
	count: number;
	/** Search latency in milliseconds */
	elapsed: number;
	/** Search mode used */
	mode: SearchMode;
}

/**
 * SQLite Search Engine
 */
export class SearchEngine {
	private store: SearchStore;
	private embeddingService: EmbeddingService;
	private model: EmbeddingModel;
	private dimensions: number;

	constructor(store: SearchStore, embeddingService: EmbeddingService, model: EmbeddingModel = "gte-small") {
		this.store = store;
		this.embeddingService = embeddingService;
		this.model = model;
		this.dimensions = EMBEDDING_MODELS[model]?.dimensions || 384;
	}

	/**
	 * Perform search combining semantic and keyword matching
	 */
	async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
		const startTime = performance.now();

		const {
			limit = 20,
			mode = "hybrid",
			type = "all",
			similarity = 0.3,
			semanticWeight = 0.6,
			keywordWeight = 0.4,
		} = options;

		let results: SearchResult[];

		switch (mode) {
			case "semantic":
				results = await this.semanticSearch(query, limit, similarity, type);
				break;
			case "keyword":
				results = this.keywordSearch(query, limit, type);
				break;
			default:
				results = await this.hybridSearch(query, limit, similarity, semanticWeight, keywordWeight, type);
				break;
		}

		const elapsed = performance.now() - startTime;

		return {
			results,
			count: results.length,
			elapsed,
			mode,
		};
	}

	/**
	 * Semantic search using vector cosine similarity
	 */
	private async semanticSearch(
		query: string,
		limit: number,
		similarity: number,
		type: "doc" | "task" | "all",
	): Promise<SearchResult[]> {
		// Generate query embedding
		const { embedding } = await this.embeddingService.embed(query);

		// Search using SQLite store
		const storeResults = this.store.search(embedding, {
			type: type === "all" ? undefined : type,
			limit,
			minScore: similarity,
		});

		return storeResults.map((r) => this.chunkToSearchResult(r.chunk, r.score, ["semantic"]));
	}

	/**
	 * Keyword search using text matching
	 */
	private keywordSearch(query: string, limit: number, type: "doc" | "task" | "all"): SearchResult[] {
		const queryLower = query.toLowerCase();
		const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 1);

		const chunks = this.store.getAllChunks(type === "all" ? undefined : type);

		// Score chunks by keyword match
		const scored = chunks
			.map((chunk) => {
				const contentLower = chunk.content.toLowerCase();
				let score = 0;

				// Exact phrase match
				if (contentLower.includes(queryLower)) {
					score += 0.5;
				}

				// Individual term matches
				for (const term of queryTerms) {
					if (contentLower.includes(term)) {
						score += 0.3 / queryTerms.length;
					}
				}

				// Boost for title/ID matches
				if (chunk.type === "task") {
					const taskChunk = chunk as TaskChunk;
					if (taskChunk.taskId.toLowerCase().includes(queryLower)) {
						score += 0.3;
					}
				} else {
					const docChunk = chunk as DocChunk;
					if (docChunk.docPath.toLowerCase().includes(queryLower)) {
						score += 0.3;
					}
					if (docChunk.section.toLowerCase().includes(queryLower)) {
						score += 0.2;
					}
				}

				return { chunk, score };
			})
			.filter((r) => r.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);

		return scored.map((r) => this.chunkToSearchResult(r.chunk, r.score, ["keyword"]));
	}

	/**
	 * Hybrid search combining semantic and keyword
	 */
	private async hybridSearch(
		query: string,
		limit: number,
		similarity: number,
		semanticWeight: number,
		keywordWeight: number,
		type: "doc" | "task" | "all",
	): Promise<SearchResult[]> {
		// Get results from both methods
		const [semanticResults, keywordResults] = await Promise.all([
			this.semanticSearch(query, limit * 2, similarity, type),
			Promise.resolve(this.keywordSearch(query, limit * 2, type)),
		]);

		// Merge results
		const resultMap = new Map<string, SearchResult>();

		// Add semantic results
		for (const result of semanticResults) {
			resultMap.set(result.id, {
				...result,
				score: result.score * semanticWeight,
				matchedBy: ["semantic"],
			});
		}

		// Merge keyword results
		for (const result of keywordResults) {
			const existing = resultMap.get(result.id);
			if (existing) {
				existing.score += result.score * keywordWeight;
				if (!existing.matchedBy.includes("keyword")) {
					existing.matchedBy.push("keyword");
				}
			} else {
				resultMap.set(result.id, {
					...result,
					score: result.score * keywordWeight,
					matchedBy: ["keyword"],
				});
			}
		}

		// Sort by combined score and limit
		return Array.from(resultMap.values())
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
	}

	/**
	 * Convert chunk to search result
	 */
	private chunkToSearchResult(chunk: Chunk, score: number, matchedBy: ("semantic" | "keyword")[]): SearchResult {
		if (chunk.type === "doc") {
			const docChunk = chunk as DocChunk;
			return {
				id: chunk.id,
				type: "doc",
				score,
				title: docChunk.section || docChunk.docPath,
				snippet: this.truncateContent(chunk.content, 200),
				path: docChunk.docPath,
				metadata: {
					headingLevel: docChunk.metadata.headingLevel,
					section: docChunk.section,
				},
				matchedBy,
			};
		}

		const taskChunk = chunk as TaskChunk;
		return {
			id: chunk.id,
			type: "task",
			score,
			title: this.extractTitle(chunk.content) || taskChunk.taskId,
			snippet: this.truncateContent(chunk.content, 200),
			taskId: taskChunk.taskId,
			metadata: {
				status: taskChunk.metadata.status,
				priority: taskChunk.metadata.priority,
				labels: taskChunk.metadata.labels,
				field: taskChunk.field,
			},
			matchedBy,
		};
	}

	/**
	 * Extract title from content (first line or truncated)
	 */
	private extractTitle(content: string): string {
		const firstLine = content.split("\n")[0].trim();
		return firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine;
	}

	/**
	 * Truncate content for snippet
	 */
	private truncateContent(content: string, maxLength: number): string {
		if (content.length <= maxLength) return content;
		return `${content.slice(0, maxLength - 3)}...`;
	}
}
