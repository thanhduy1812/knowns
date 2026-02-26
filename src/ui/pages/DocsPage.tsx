import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Plus,
	FileText,
	Folder,
	FolderOpen,
	Pencil,
	Check,
	X,
	Copy,
	Download,
	Package,
	ListChecks,
	Filter,
	ClipboardCheck,
	ChevronDown,
	ChevronUp,
	ExternalLink,
	PanelLeftClose,
	PanelLeft,
	Menu,
	ChevronRight,
	Home,
} from "lucide-react";
import type { Task } from "../../models/task";
import { MDEditor, MDRender } from "../components/editor";
import { ScrollArea } from "../components/ui/scroll-area";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { TreeView, type TreeDataItem } from "../components/ui/tree-view";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { getDocs, createDoc, updateDoc, getTasksBySpec } from "../api/client";
import { useSSEEvent } from "../contexts/SSEContext";
import { useGlobalTask } from "../contexts/GlobalTaskContext";
import { normalizePath, toDisplayPath, normalizePathForAPI, isSpec, getSpecStatus, getSpecStatusOrder, parseACProgress, type Doc } from "../lib/utils";


export default function DocsPage() {
	const { openTask } = useGlobalTask();
	const [docs, setDocs] = useState<Doc[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
	const [isEditing, setIsEditing] = useState(false);
	const [editedContent, setEditedContent] = useState("");
	const [saving, setSaving] = useState(false);
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [newDocTitle, setNewDocTitle] = useState("");
	const [newDocDescription, setNewDocDescription] = useState("");
	const [newDocTags, setNewDocTags] = useState("");
	const [newDocFolder, setNewDocFolder] = useState("");
	const [newDocContent, setNewDocContent] = useState("");
	const [creating, setCreating] = useState(false);
	const [pathCopied, setPathCopied] = useState(false);
	const [linkedTasks, setLinkedTasks] = useState<Task[]>([]);
	const [linkedTasksExpanded, setLinkedTasksExpanded] = useState(false);
	const [showSpecsOnly, setShowSpecsOnly] = useState(() => {
		const saved = localStorage.getItem("docs-specs-only");
		return saved === "true";
	});
	const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
		const saved = localStorage.getItem("docs-sidebar-collapsed");
		return saved === "true";
	});
	const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
	const markdownPreviewRef = useRef<HTMLDivElement>(null);
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	const scrollPositions = useRef<Map<string, number>>(new Map());

	// Save scroll position before changing doc
	const saveScrollPosition = useCallback(() => {
		if (selectedDoc && scrollAreaRef.current) {
			const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
			if (viewport) {
				scrollPositions.current.set(selectedDoc.path, viewport.scrollTop);
			}
		}
	}, [selectedDoc]);

	// Restore scroll position when doc changes
	useEffect(() => {
		if (selectedDoc && scrollAreaRef.current) {
			const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
			if (viewport) {
				const savedPosition = scrollPositions.current.get(selectedDoc.path) || 0;
				// Small delay to ensure content is rendered
				requestAnimationFrame(() => {
					viewport.scrollTop = savedPosition;
				});
			}
		}
	}, [selectedDoc?.path]);

	// Persist sidebar and filter state to localStorage
	useEffect(() => {
		localStorage.setItem("docs-sidebar-collapsed", String(sidebarCollapsed));
	}, [sidebarCollapsed]);

	useEffect(() => {
		localStorage.setItem("docs-specs-only", String(showSpecsOnly));
	}, [showSpecsOnly]);

	// Keyboard shortcut: Ctrl+B to toggle sidebar
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "b") {
				e.preventDefault();
				setSidebarCollapsed((prev) => !prev);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	// Initial docs load
	useEffect(() => {
		loadDocs();
	}, []);

	// Fetch linked tasks when a spec is selected
	useEffect(() => {
		if (selectedDoc && isSpec(selectedDoc)) {
			const specPath = toDisplayPath(selectedDoc.path).replace(/\.md$/, "");
			getTasksBySpec(specPath)
				.then((tasks) => setLinkedTasks(tasks))
				.catch(() => setLinkedTasks([]));
		} else {
			setLinkedTasks([]);
		}
	}, [selectedDoc]);

	// Subscribe to SSE for real-time updates from CLI/AI
	useSSEEvent("docs:updated", () => {
		loadDocs();
	});

	useSSEEvent("docs:refresh", () => {
		loadDocs();
	});

	// Handle doc path from URL navigation (e.g., #/docs/patterns/controller.md)
	const handleHashNavigation = useCallback(() => {
		if (docs.length === 0) return;

		const hash = window.location.hash;
		// Match pattern: #/docs/{path}
		const match = hash.match(/^#\/docs\/(.+)$/);

		if (match) {
			const docPath = decodeURIComponent(match[1]);
			// Normalize path - convert backslashes to forward slashes and clean up
			const normalizedDocPath = normalizePath(docPath).replace(/^\.\//, "").replace(/^\//, "");
			// Also create a version without .md for comparison
			const normalizedDocPathNoExt = normalizedDocPath.replace(/\.md$/, "");

			// Find document - normalize both sides for comparison
			const targetDoc = docs.find((doc) => {
				const normalizedStoredPath = normalizePath(doc.path);
				const normalizedStoredPathNoExt = normalizedStoredPath.replace(/\.md$/, "");
				return (
					normalizedStoredPath === normalizedDocPath ||
					normalizedStoredPath === normalizedDocPathNoExt ||
					normalizedStoredPathNoExt === normalizedDocPath ||
					normalizedStoredPathNoExt === normalizedDocPathNoExt ||
					normalizedStoredPath.endsWith(`/${normalizedDocPath}`) ||
					normalizedStoredPath.endsWith(`/${normalizedDocPathNoExt}`) ||
					doc.filename === normalizedDocPath ||
					doc.filename === normalizedDocPathNoExt
				);
			});

			if (targetDoc && targetDoc !== selectedDoc) {
				saveScrollPosition();
				setSelectedDoc(targetDoc);
				setIsEditing(false);
			}
		}
	}, [docs, selectedDoc, saveScrollPosition]);

	// Handle initial load and docs change
	useEffect(() => {
		handleHashNavigation();
	}, [handleHashNavigation]);


	// Handle hash changes (when user navigates or changes URL)
	useEffect(() => {
		window.addEventListener("hashchange", handleHashNavigation);
		return () => window.removeEventListener("hashchange", handleHashNavigation);
	}, [handleHashNavigation]);

	// Handle markdown link clicks for internal navigation
	useEffect(() => {
		const handleLinkClick = (e: MouseEvent) => {
			let target = e.target as HTMLElement;

			// If clicked on SVG or child element, find parent anchor
			while (target && target.tagName !== "A" && target !== markdownPreviewRef.current) {
				target = target.parentElement as HTMLElement;
			}

			if (target && target.tagName === "A") {
				const anchor = target as HTMLAnchorElement;
				const href = anchor.getAttribute("href");

				// Handle task links (task-xxx or @task-xxx)
				if (href && /^@?task-[\w.]+(.md)?$/.test(href)) {
					e.preventDefault();
					const taskId = href.replace(/^@/, "").replace(/^task-/, "").replace(".md", "");

					// Open task in global modal (stays on current page)
					openTask(taskId);
					return;
				}

				// Handle @doc/xxx format links
				if (href && href.startsWith("@doc/")) {
					e.preventDefault();
					const docPath = href.replace("@doc/", "");
					window.location.hash = `/docs/${docPath}.md`;
					return;
				}

				// Handle document links (.md extension)
				if (href && (href.endsWith(".md") || href.includes(".md#"))) {
					e.preventDefault();

					// Normalize the path (remove leading ./, ../, etc.)
					let docPath = href.replace(/^\.\//, "").replace(/^\//, "");

					// Remove anchor if present
					docPath = docPath.split("#")[0];

					// Navigate using hash to update URL
					window.location.hash = `/docs/${docPath}`;
				}
			}
		};

		const previewEl = markdownPreviewRef.current;
		if (previewEl) {
			previewEl.addEventListener("click", handleLinkClick);
			return () => previewEl.removeEventListener("click", handleLinkClick);
		}
	}, [docs, selectedDoc, openTask]);

	const loadDocs = () => {
		getDocs()
			.then((docs) => {
				setDocs(docs as Doc[]);
				setLoading(false);
			})
			.catch((err) => {
				console.error("Failed to load docs:", err);
				setLoading(false);
			});
	};

	const handleCreateDoc = async () => {
		if (!newDocTitle.trim()) {
			alert("Please enter a title");
			return;
		}

		setCreating(true);
		try {
			const tags = newDocTags
				.split(",")
				.map((t) => t.trim())
				.filter((t) => t);

			await createDoc({
				title: newDocTitle,
				description: newDocDescription,
				tags,
				folder: newDocFolder,
				content: newDocContent,
			});

			// Reset form
			setNewDocTitle("");
			setNewDocDescription("");
			setNewDocTags("");
			setNewDocFolder("");
			setNewDocContent("");
			setShowCreateModal(false);

			// Reload docs
			loadDocs();
		} catch (error) {
			console.error("Failed to create doc:", error);
			alert("Failed to create document. Please try again.");
		} finally {
			setCreating(false);
		}
	};

	const handleEdit = () => {
		if (selectedDoc) {
			setEditedContent(selectedDoc.content);
			setIsEditing(true);
		}
	};

	const handleCopyPath = () => {
		if (selectedDoc) {
			// Copy as @doc/... reference format (normalize path for cross-platform)
			const normalizedPath = toDisplayPath(selectedDoc.path).replace(/\.md$/, "");
			const refPath = `@doc/${normalizedPath}`;
			navigator.clipboard.writeText(refPath).then(() => {
				setPathCopied(true);
				setTimeout(() => setPathCopied(false), 2000);
			});
		}
	};

	const handleSave = async () => {
		if (!selectedDoc) return;

		setSaving(true);
		try {
			// Update doc via API - normalize path for cross-platform compatibility
			const updatedDoc = await updateDoc(normalizePathForAPI(selectedDoc.path), {
				content: editedContent,
			});

			// Update local state
			setDocs((prevDocs) =>
				prevDocs.map((doc) =>
					doc.path === selectedDoc.path
						? { ...doc, content: editedContent, metadata: { ...doc.metadata, updatedAt: new Date().toISOString() } }
						: doc
				)
			);
			setSelectedDoc((prev) => (prev ? { ...prev, content: editedContent } : prev));
			setIsEditing(false);
		} catch (error) {
			console.error("Failed to save doc:", error);
			alert(error instanceof Error ? error.message : "Failed to save document");
		} finally {
			setSaving(false);
		}
	};

	const handleCancel = () => {
		setIsEditing(false);
		setEditedContent("");
	};

	// Build TreeDataItem[] from docs
	const buildDocsTreeData = useCallback((docList: Doc[], onSelectDoc: (doc: Doc) => void): TreeDataItem[] => {
		interface TempNode {
			id: string;
			name: string;
			isDoc: boolean;
			doc?: Doc;
			children: Map<string, TempNode>;
		}

		const root: Map<string, TempNode> = new Map();

		for (const doc of docList) {
			// For imported docs, extract folder from the path after import name
			let folder = doc.folder;
			if (doc.isImported && doc.source) {
				const pathWithoutImport = doc.path.replace(`${doc.source}/`, "");
				const parts = pathWithoutImport.split("/");
				folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
			}

			const parts = folder ? folder.split("/") : [];
			let currentMap = root;

			// Build folder hierarchy
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				const currentPath = parts.slice(0, i + 1).join("/");

				if (!currentMap.has(part)) {
					currentMap.set(part, {
						id: currentPath,
						name: part,
						isDoc: false,
						children: new Map(),
					});
				}
				currentMap = currentMap.get(part)!.children;
			}

			// Add doc as leaf
			currentMap.set(doc.path, {
				id: doc.path,
				name: doc.metadata.title,
				isDoc: true,
				doc,
				children: new Map(),
			});
		}

		// Convert TempNode to TreeDataItem
		const convertToTreeData = (nodeMap: Map<string, TempNode>): TreeDataItem[] => {
			return Array.from(nodeMap.values())
				.sort((a, b) => {
					// Folders first, then docs
					if (a.isDoc !== b.isDoc) return a.isDoc ? 1 : -1;

					// For docs: sort by order first, then createdAt, then alphabetically
					if (a.isDoc && b.isDoc && a.doc && b.doc) {
						const orderA = a.doc.metadata.order;
						const orderB = b.doc.metadata.order;

						// Both have order: sort by order
						if (orderA !== undefined && orderB !== undefined) {
							return orderA - orderB;
						}
						// Only one has order: ordered items come first
						if (orderA !== undefined) return -1;
						if (orderB !== undefined) return 1;

						// Neither has order: sort by createdAt, then alphabetically
						const createdA = a.doc.metadata.createdAt;
						const createdB = b.doc.metadata.createdAt;
						if (createdA && createdB) {
							const dateCompare = new Date(createdA).getTime() - new Date(createdB).getTime();
							if (dateCompare !== 0) return dateCompare;
						}
					}

					// Final fallback: alphabetical by name
					return a.name.localeCompare(b.name);
				})
				.map((node): TreeDataItem => {
					if (node.isDoc && node.doc) {
						// For specs, show AC progress in the name and use different icon
						let displayName = node.name;
						const docIsSpec = isSpec(node.doc);
						if (docIsSpec) {
							const acProgress = parseACProgress(node.doc.content);
							if (acProgress.total > 0) {
								displayName = `${node.name} (${acProgress.completed}/${acProgress.total})`;
							}
						}
						return {
							id: node.id,
							name: displayName,
							icon: docIsSpec ? ClipboardCheck : FileText,
							onClick: () => {
								window.location.hash = `/docs/${toDisplayPath(node.doc!.path)}`;
							},
						};
					}
					return {
						id: node.id,
						name: node.name,
						icon: Folder,
						openIcon: FolderOpen,
						children: node.children.size > 0 ? convertToTreeData(node.children) : undefined,
					};
				});
		};

		return convertToTreeData(root);
	}, []);

	// Separate local and imported docs, optionally filter to specs only
	const localDocs = useMemo(() => {
		let filtered = docs.filter(d => !d.isImported);
		if (showSpecsOnly) {
			filtered = filtered.filter(d => isSpec(d));
			// Sort by status: draft -> approved -> implemented
			filtered.sort((a, b) => getSpecStatusOrder(a) - getSpecStatusOrder(b));
		}
		return filtered;
	}, [docs, showSpecsOnly]);

	const importedDocs = useMemo(() => {
		let filtered = docs.filter(d => d.isImported);
		if (showSpecsOnly) {
			filtered = filtered.filter(d => isSpec(d));
			filtered.sort((a, b) => getSpecStatusOrder(a) - getSpecStatusOrder(b));
		}
		return filtered;
	}, [docs, showSpecsOnly]);

	// Group imported docs by source
	const importsBySource = importedDocs.reduce((acc, doc) => {
		const source = doc.source || "unknown";
		if (!acc[source]) acc[source] = [];
		acc[source].push(doc);
		return acc;
	}, {} as Record<string, Doc[]>);

	// Build tree data for local docs
	const localTreeData = useMemo(() =>
		buildDocsTreeData(localDocs, (doc) => {
			window.location.hash = `/docs/${toDisplayPath(doc.path)}`;
		}),
		[localDocs, buildDocsTreeData]
	);

	// Build tree data for each import source
	const importsTreeData = useMemo(() => {
		return Object.entries(importsBySource).map(([source, sourceDocs]): TreeDataItem => ({
			id: `__import_${source}__`,
			name: source,
			icon: Package,
			children: buildDocsTreeData(sourceDocs, (doc) => {
				window.location.hash = `/docs/${toDisplayPath(doc.path)}`;
			}),
		}));
	}, [importsBySource, buildDocsTreeData]);

	if (loading) {
		return (
			<div className="p-6 flex items-center justify-center h-64">
				<div className="text-lg text-muted-foreground">Loading documentation...</div>
			</div>
		);
	}

	return (
		<div className="p-3 sm:p-6 h-full flex flex-col overflow-hidden">
			{/* Header */}
			<div className="mb-4 sm:mb-6 flex items-center justify-between gap-2 sm:gap-4">
				<div className="flex items-center gap-2">
					{/* Mobile menu button */}
					<Button
						variant="outline"
						size="sm"
						className="lg:hidden shrink-0"
						onClick={() => setMobileDrawerOpen(true)}
					>
						<Menu className="w-4 h-4" />
					</Button>
					<h1 className="text-xl sm:text-2xl font-bold truncate">Documentation</h1>
				</div>
				<Button
					onClick={() => setShowCreateModal(true)}
					className="bg-green-700 hover:bg-green-800 text-white"
				>
					<Plus className="w-4 h-4 mr-2" />
					<span className="hidden sm:inline">New Document</span>
					<span className="sm:hidden">New</span>
				</Button>
			</div>

			<div className="flex gap-3 sm:gap-6 flex-1 min-h-0 overflow-hidden">
				{/* Sidebar Toggle Button (when collapsed) */}
				{sidebarCollapsed && (
					<div className="shrink-0 hidden lg:block">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setSidebarCollapsed(false)}
							title="Show sidebar"
						>
							<PanelLeft className="w-4 h-4" />
						</Button>
					</div>
				)}

				{/* Doc List Sidebar */}
				<div
					className={`flex-col min-h-0 overflow-hidden transition-all duration-300 hidden lg:flex ${
						sidebarCollapsed ? "w-0 opacity-0 pointer-events-none -ml-6" : "w-80 shrink-0"
					}`}
				>
					<div className="bg-card rounded-lg border overflow-hidden flex flex-col flex-1 min-h-0">
						<div className="p-3 border-b shrink-0 flex items-center justify-between gap-2">
							<div className="flex items-center gap-1 shrink-0">
								<Button
									variant={showSpecsOnly ? "default" : "outline"}
									size="sm"
									onClick={() => setShowSpecsOnly(!showSpecsOnly)}
									title={showSpecsOnly ? "Show all documents" : "Show specs only"}
								>
									<Filter className="w-4 h-4 mr-1" />
									Specs
								</Button>
							</div>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setSidebarCollapsed(true)}
								title="Collapse sidebar"
							>
								<PanelLeftClose className="w-4 h-4" />
							</Button>
						</div>
						<ScrollArea className="flex-1">
							{/* Local Docs Section */}
							{localDocs.length > 0 && (
								<TreeView
									data={{
										id: "__local__",
										name: `Local (${localDocs.length})`,
										icon: Folder,
										openIcon: FolderOpen,
										children: localTreeData,
									}}
									defaultNodeIcon={Folder}
									defaultLeafIcon={FileText}
									initialSelectedItemId={selectedDoc?.path}
								/>
							)}

							{/* Imported Docs Section */}
							{importsTreeData.length > 0 && (
								<TreeView
									data={{
										id: "__imports__",
										name: `Imports (${importedDocs.length})`,
										icon: Download,
										openIcon: Download,
										children: importsTreeData,
									}}
									defaultNodeIcon={Folder}
									defaultLeafIcon={FileText}
									initialSelectedItemId={selectedDoc?.path}
								/>
							)}
						</ScrollArea>
					</div>

					{docs.length === 0 && (
						<div className="bg-card rounded-lg border p-8 text-center">
							<FileText className="w-5 h-5" />
							<p className="mt-2 text-muted-foreground">No documentation found</p>
							<p className="text-sm text-muted-foreground mt-1">
								Create a doc with: <code className="font-mono">knowns doc create "Title"</code>
							</p>
						</div>
					)}
				</div>

				{/* Doc Content */}
				<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
					{selectedDoc ? (
						<div className="bg-card rounded-lg border overflow-hidden flex flex-col flex-1 min-h-0">
							{/* Header - Compact on mobile */}
							<div className="p-3 sm:p-4 border-b shrink-0">
								{/* Top row: Breadcrumb + Edit Button */}
								<div className="flex items-center justify-between gap-2 mb-2">
									{/* Breadcrumb - simplified on mobile */}
									<nav className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground min-w-0 flex-1">
										<button
											type="button"
											onClick={() => {
												saveScrollPosition();
												setSelectedDoc(null);
											}}
											className="hover:text-foreground transition-colors flex items-center gap-1 shrink-0"
										>
											<Home className="w-3.5 h-3.5" />
											<span className="hidden sm:inline">Docs</span>
										</button>
										{selectedDoc.folder && (
											<>
												<ChevronRight className="w-3 h-3 shrink-0" />
												<span className="truncate max-w-[80px] sm:max-w-none">{selectedDoc.folder}</span>
											</>
										)}
										<ChevronRight className="w-3 h-3 shrink-0" />
										<span className="text-foreground font-medium truncate">
											{selectedDoc.metadata.title}
										</span>
									</nav>

									{/* Edit/Save/Cancel Buttons */}
									<div className="flex gap-1.5 sm:gap-2 shrink-0">
										{!isEditing ? (
											<Button
												size="sm"
												onClick={handleEdit}
												disabled={selectedDoc.isImported}
												title={selectedDoc.isImported ? "Imported docs are read-only" : "Edit document"}
											>
												<Pencil className="w-4 h-4 sm:mr-2" />
												<span className="hidden sm:inline">Edit</span>
											</Button>
										) : (
											<>
												<Button
													size="sm"
													onClick={handleSave}
													disabled={saving}
													className="bg-green-700 hover:bg-green-800 text-white"
												>
													<Check className="w-4 h-4 sm:mr-2" />
													<span className="hidden sm:inline">{saving ? "Saving..." : "Save"}</span>
												</Button>
												<Button
													size="sm"
													variant="secondary"
													onClick={handleCancel}
													disabled={saving}
												>
													<X className="w-4 h-4 sm:mr-2" />
													<span className="hidden sm:inline">Cancel</span>
												</Button>
											</>
										)}
									</div>
								</div>

								{/* Title + Badges */}
								<div className="flex items-center gap-2 flex-wrap mb-2">
									<h2 className="text-lg sm:text-xl font-bold">
										{selectedDoc.metadata.title}
									</h2>
									{isSpec(selectedDoc) && (
										<Badge className="bg-purple-600 hover:bg-purple-700 text-white text-xs">
											SPEC
										</Badge>
									)}
									{isSpec(selectedDoc) && getSpecStatus(selectedDoc) && (
										<Badge
											className={`text-xs ${
												getSpecStatus(selectedDoc) === "approved"
													? "bg-green-600 hover:bg-green-700 text-white"
													: getSpecStatus(selectedDoc) === "implemented"
														? "bg-blue-600 hover:bg-blue-700 text-white"
														: "bg-yellow-600 hover:bg-yellow-700 text-white"
											}`}
										>
											{getSpecStatus(selectedDoc)?.charAt(0).toUpperCase() + getSpecStatus(selectedDoc)?.slice(1)}
										</Badge>
									)}
									{selectedDoc.isImported && (
										<span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">
											Imported
										</span>
									)}
								</div>

								{/* Spec AC Progress & Linked Tasks - Compact on mobile */}
								{isSpec(selectedDoc) && (() => {
									const acProgress = parseACProgress(selectedDoc.content);
									return (
										<>
											<div className="flex items-center gap-3 sm:gap-6 mb-2 flex-wrap">
												{acProgress.total > 0 && (
													<div className="flex items-center gap-2">
														<ListChecks className="w-4 h-4 text-muted-foreground" />
														<Progress value={Math.round((acProgress.completed / acProgress.total) * 100)} className="w-20 sm:w-32 h-2" />
														<span className="text-xs sm:text-sm text-muted-foreground">
															{acProgress.completed}/{acProgress.total}
														</span>
													</div>
												)}
												<button
													type="button"
													onClick={() => setLinkedTasksExpanded(!linkedTasksExpanded)}
													className="flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
												>
													<FileText className="w-3.5 h-3.5" />
													<span>{linkedTasks.length} tasks</span>
													{linkedTasks.length > 0 && (
														linkedTasksExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
													)}
												</button>
											</div>
											{linkedTasksExpanded && linkedTasks.length > 0 && (
												<div className="mb-2 p-2 sm:p-3 rounded-lg bg-muted/50 border text-sm">
													<div className="space-y-1.5">
														{linkedTasks.map((task) => (
															<button
																type="button"
																key={task.id}
																onClick={() => openTask(task.id)}
																className="flex items-center justify-between p-1.5 rounded hover:bg-background transition-colors group w-full text-left"
															>
																<div className="flex items-center gap-2 min-w-0">
																	<span className={`w-2 h-2 rounded-full shrink-0 ${
																		task.status === "done" ? "bg-green-500" :
																		task.status === "in-progress" ? "bg-yellow-500" :
																		task.status === "blocked" ? "bg-red-500" : "bg-gray-400"
																	}`} />
																	<span className="text-xs font-mono text-muted-foreground">#{task.id}</span>
																	<span className="text-xs sm:text-sm truncate">{task.title}</span>
																</div>
																<ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
															</button>
														))}
													</div>
												</div>
											)}
										</>
									);
								})()}

								{/* Description - hidden on mobile if no description */}
								{selectedDoc.metadata.description && (
									<p className="text-xs sm:text-sm text-muted-foreground mb-2 line-clamp-2">{selectedDoc.metadata.description}</p>
								)}

								{/* Path + Updated - Single line on mobile */}
								<div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
									<button
										type="button"
										onClick={handleCopyPath}
										className="flex items-center gap-1 hover:text-foreground transition-colors"
										title="Click to copy reference"
									>
										<Copy className="w-3 h-3" />
										<span className="font-mono truncate max-w-[150px] sm:max-w-none">@doc/{toDisplayPath(selectedDoc.path).replace(/\.md$/, "")}</span>
									</button>
									<span className="hidden sm:inline">•</span>
									<span className="hidden sm:inline">Updated: {new Date(selectedDoc.metadata.updatedAt).toLocaleString()}</span>
								</div>
							</div>

							{/* Content */}
							{isEditing ? (
								<div className="flex-1 min-h-0 overflow-hidden p-6">
									<MDEditor
										markdown={editedContent}
										onChange={setEditedContent}
										placeholder="Write your documentation here..."
										height="100%"
										className="h-full"
									/>
								</div>
							) : (
								<ScrollArea className="flex-1" ref={scrollAreaRef}>
									<div className="p-6 prose prose-sm dark:prose-invert max-w-none" ref={markdownPreviewRef}>
										<MDRender
											markdown={selectedDoc.content || ""}
											onTaskLinkClick={openTask}
										/>
									</div>
								</ScrollArea>
							)}
						</div>
					) : (
						<div className="bg-card rounded-lg border p-12 text-center">
							<FileText className="w-5 h-5" />
							<p className="mt-4 text-muted-foreground">Select a document to view its content</p>
						</div>
					)}
				</div>
			</div>

			{/* Mobile Drawer */}
			<Sheet open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
				<SheetContent side="left" className="w-[85vw] max-w-80 p-0">
					<SheetHeader className="p-4 border-b">
						<SheetTitle>Documents</SheetTitle>
					</SheetHeader>
					<div className="p-3 border-b flex items-center gap-2">
						<Button
							variant={showSpecsOnly ? "default" : "outline"}
							size="sm"
							onClick={() => setShowSpecsOnly(!showSpecsOnly)}
							className="flex-1"
						>
							<Filter className="w-4 h-4 mr-1" />
							Specs Only
						</Button>
					</div>
					<ScrollArea className="flex-1 h-[calc(100vh-130px)]">
						{/* Local Docs Section */}
						{localDocs.length > 0 && (
							<TreeView
								data={{
									id: "__local_mobile__",
									name: `Local (${localDocs.length})`,
									icon: Folder,
									openIcon: FolderOpen,
									children: localTreeData,
								}}
								defaultNodeIcon={Folder}
								defaultLeafIcon={FileText}
								initialSelectedItemId={selectedDoc?.path}
							/>
						)}

						{/* Imported Docs Section */}
						{importsTreeData.length > 0 && (
							<TreeView
								data={{
									id: "__imports_mobile__",
									name: `Imports (${importedDocs.length})`,
									icon: Download,
									openIcon: Download,
									children: importsTreeData,
								}}
								defaultNodeIcon={Folder}
								defaultLeafIcon={FileText}
								initialSelectedItemId={selectedDoc?.path}
							/>
						)}
					</ScrollArea>
				</SheetContent>
			</Sheet>

			{/* Create Document Modal */}
			{showCreateModal && (
				<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4">
					<div className="bg-card rounded-lg shadow-xl max-w-4xl w-full h-[95vh] sm:h-[90vh] flex flex-col">
						<div className="p-3 sm:p-6 border-b shrink-0">
							<h2 className="text-lg sm:text-xl font-bold">Create New Document</h2>
						</div>

						<div className="p-3 sm:p-6 space-y-3 sm:space-y-4 flex-1 flex flex-col overflow-hidden">
							{/* Title */}
							<div className="shrink-0">
								<label className="block text-sm font-medium mb-2">Title *</label>
								<Input
									type="text"
									value={newDocTitle}
									onChange={(e) => setNewDocTitle(e.target.value)}
									placeholder="Document title"
								/>
							</div>

							{/* Description */}
							<div className="shrink-0">
								<label className="block text-sm font-medium mb-2">Description</label>
								<Input
									type="text"
									value={newDocDescription}
									onChange={(e) => setNewDocDescription(e.target.value)}
									placeholder="Brief description"
								/>
							</div>

							{/* Folder */}
							<div className="shrink-0">
								<label className="block text-sm font-medium mb-2">
									Folder (optional)
								</label>
								<Input
									type="text"
									value={newDocFolder}
									onChange={(e) => setNewDocFolder(e.target.value)}
									placeholder="api/auth, guides, etc. (leave empty for root)"
								/>
							</div>

							{/* Tags */}
							<div className="shrink-0">
								<label className="block text-sm font-medium mb-2">
									Tags (comma-separated)
								</label>
								<Input
									type="text"
									value={newDocTags}
									onChange={(e) => setNewDocTags(e.target.value)}
									placeholder="guide, tutorial, api"
								/>
							</div>

							{/* Content */}
							<div className="flex-1 flex flex-col min-h-0">
								<label className="block text-sm font-medium mb-2">Content</label>
								<div className="flex-1 min-h-0">
									<MDEditor
										markdown={newDocContent}
										onChange={setNewDocContent}
										placeholder="Write your documentation here..."
										height="100%"
										className="h-full"
									/>
								</div>
							</div>
						</div>

						<div className="p-3 sm:p-6 border-t flex justify-end gap-2 sm:gap-3 shrink-0">
							<Button
								variant="secondary"
								onClick={() => {
									setShowCreateModal(false);
									setNewDocTitle("");
									setNewDocDescription("");
									setNewDocTags("");
									setNewDocFolder("");
									setNewDocContent("");
								}}
								disabled={creating}
							>
								Cancel
							</Button>
							<Button
								onClick={handleCreateDoc}
								disabled={creating || !newDocTitle.trim()}
								className="bg-green-700 hover:bg-green-800 text-white"
							>
								{creating ? "Creating..." : "Create Document"}
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
