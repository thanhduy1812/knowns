/**
 * Index Service
 * Provides incremental indexing for tasks and docs using SQLite
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Task } from "@models/task";
import { chunkDocument, chunkTask } from "./chunker";
import { EmbeddingService } from "./embedding";
import { SearchStore } from "./store";
import type { DocMetadata, EmbeddingModel } from "./types";

/**
 * Index Service Configuration
 */
export interface IndexServiceConfig {
	projectRoot: string;
}

/**
 * Index Service
 * Handles incremental indexing for semantic search
 */
export class IndexService {
	private projectRoot: string;
	private embeddingService: EmbeddingService | null = null;
	private store: SearchStore | null = null;
	private initialized = false;
	private enabled: boolean | null = null;
	private model: EmbeddingModel = "gte-small";

	constructor(config: IndexServiceConfig) {
		this.projectRoot = config.projectRoot;
	}

	/**
	 * Check if semantic search is enabled for this project
	 */
	async isEnabled(): Promise<boolean> {
		if (this.enabled !== null) {
			return this.enabled;
		}

		try {
			const configPath = join(this.projectRoot, ".knowns", "config.json");
			if (!existsSync(configPath)) {
				this.enabled = false;
				return false;
			}

			const content = await readFile(configPath, "utf-8");
			const config = JSON.parse(content);
			this.enabled = config.settings?.semanticSearch?.enabled === true;
			if (this.enabled && config.settings?.semanticSearch?.model) {
				this.model = config.settings.semanticSearch.model;
			}
			return this.enabled;
		} catch {
			this.enabled = false;
			return false;
		}
	}

	/**
	 * Ensure the service is initialized
	 */
	private async ensureInitialized(): Promise<boolean> {
		if (this.initialized) return true;

		const enabled = await this.isEnabled();
		if (!enabled) return false;

		try {
			// Initialize embedding service
			this.embeddingService = new EmbeddingService({ model: this.model });

			// Check if model is downloaded
			if (!this.embeddingService.isModelDownloaded()) {
				// Model not downloaded, can't index
				console.warn(`Semantic search model "${this.model}" not downloaded. Run "knowns search --setup" to download.`);
				return false;
			}

			// Load the model
			await this.embeddingService.loadModel();

			// Initialize SQLite store
			this.store = new SearchStore(this.projectRoot, this.model);

			this.initialized = true;
			return true;
		} catch (error) {
			console.warn("Failed to initialize index service:", error);
			return false;
		}
	}

	/**
	 * Index a task (create or update)
	 */
	async indexTask(task: Task): Promise<void> {
		const ready = await this.ensureInitialized();
		if (!ready || !this.embeddingService || !this.store) return;

		try {
			// Remove existing chunks for this task
			this.store.removeChunks(`task:${task.id}:`);

			// Create chunks from task
			const chunkResult = chunkTask(task, this.model);

			// Generate embeddings
			const embeddedChunks = await this.embeddingService.embedChunks(chunkResult.chunks);

			// Add to SQLite (auto-persisted)
			this.store.addChunks(embeddedChunks);
		} catch (error) {
			console.warn(`Failed to index task ${task.id}:`, error);
		}
	}

	/**
	 * Remove a task from the index
	 */
	async removeTask(taskId: string): Promise<void> {
		const ready = await this.ensureInitialized();
		if (!ready || !this.store) return;

		try {
			this.store.removeChunks(`task:${taskId}:`);
		} catch (error) {
			console.warn(`Failed to remove task ${taskId} from index:`, error);
		}
	}

	/**
	 * Index a document (create or update)
	 */
	async indexDoc(docPath: string, content: string, metadata: DocMetadata): Promise<void> {
		const ready = await this.ensureInitialized();
		if (!ready || !this.embeddingService || !this.store) return;

		try {
			// Remove existing chunks for this doc
			this.store.removeChunks(`doc:${docPath}:`);

			// Create chunks from document
			const chunkResult = chunkDocument(content, metadata, this.model);

			// Generate embeddings
			const embeddedChunks = await this.embeddingService.embedChunks(chunkResult.chunks);

			// Add to SQLite (auto-persisted)
			this.store.addChunks(embeddedChunks);
		} catch (error) {
			console.warn(`Failed to index doc ${docPath}:`, error);
		}
	}

	/**
	 * Remove a document from the index
	 */
	async removeDoc(docPath: string): Promise<void> {
		const ready = await this.ensureInitialized();
		if (!ready || !this.store) return;

		try {
			this.store.removeChunks(`doc:${docPath}:`);
		} catch (error) {
			console.warn(`Failed to remove doc ${docPath} from index:`, error);
		}
	}

	/**
	 * Get the SQLite store (for search operations)
	 */
	getStore(): SearchStore | null {
		return this.store;
	}

	/**
	 * Get the embedding service
	 */
	getEmbeddingService(): EmbeddingService | null {
		return this.embeddingService;
	}

	/**
	 * Get the model
	 */
	getModel(): EmbeddingModel {
		return this.model;
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		if (this.embeddingService) {
			this.embeddingService.dispose();
		}
		if (this.store) {
			this.store.close();
		}
		this.embeddingService = null;
		this.store = null;
		this.initialized = false;
	}
}

// Cache for IndexService instances per project
const indexServiceCache = new Map<string, IndexService>();

/**
 * Get IndexService for a project (cached)
 */
export function getIndexService(projectRoot: string): IndexService {
	let service = indexServiceCache.get(projectRoot);
	if (!service) {
		service = new IndexService({ projectRoot });
		indexServiceCache.set(projectRoot, service);
	}
	return service;
}

/**
 * Clear IndexService cache (for testing)
 */
export function clearIndexServiceCache(): void {
	for (const service of indexServiceCache.values()) {
		service.dispose();
	}
	indexServiceCache.clear();
}
