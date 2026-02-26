import { useState } from "react";
import { Plus, Archive, ChevronDown, ListTodo, ArrowRight, X } from "lucide-react";
import type { Task } from "../../models/task";
import { Board } from "../components/organisms";
import { Button } from "../components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { api } from "../api/client";
import { toast } from "../components/ui/sonner";
import { useIsMobile } from "../hooks/use-mobile";

// Time duration options for batch archive (in milliseconds)
const BATCH_ARCHIVE_OPTIONS = [
	{ label: "1 hour ago", value: 1 * 60 * 60 * 1000 },
	{ label: "1 day ago", value: 24 * 60 * 60 * 1000 },
	{ label: "1 week ago", value: 7 * 24 * 60 * 60 * 1000 },
	{ label: "1 month ago", value: 30 * 24 * 60 * 60 * 1000 },
	{ label: "3 months ago", value: 90 * 24 * 60 * 60 * 1000 },
];

interface KanbanPageProps {
	tasks: Task[];
	loading: boolean;
	onTasksUpdate: (tasks: Task[]) => void;
	onNewTask: () => void;
}

export default function KanbanPage({ tasks, loading, onTasksUpdate, onNewTask }: KanbanPageProps) {
	const isMobile = useIsMobile();
	const [mobileWarningDismissed, setMobileWarningDismissed] = useState(() => {
		return sessionStorage.getItem("kanban-mobile-warning-dismissed") === "true";
	});

	// Count done tasks for batch archive preview
	const getDoneTasksCount = (olderThanMs: number): number => {
		const cutoffTime = Date.now() - olderThanMs;
		return tasks.filter(
			(t) => t.status === "done" && new Date(t.updatedAt).getTime() < cutoffTime
		).length;
	};

	const handleBatchArchive = async (olderThanMs: number, label: string) => {
		try {
			const result = await api.batchArchiveTasks(olderThanMs);
			if (result.count > 0) {
				// Remove archived tasks from list
				const archivedIds = new Set(result.tasks.map((t) => t.id));
				onTasksUpdate(tasks.filter((t) => !archivedIds.has(t.id)));
				toast.success(`Archived ${result.count} task${result.count > 1 ? "s" : ""} done before ${label}`);
			} else {
				toast.info(`No done tasks found before ${label}`);
			}
		} catch (error) {
			console.error("Failed to batch archive tasks:", error);
			toast.error("Failed to archive tasks");
		}
	};

	const dismissMobileWarning = () => {
		setMobileWarningDismissed(true);
		sessionStorage.setItem("kanban-mobile-warning-dismissed", "true");
	};

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Mobile Warning Banner */}
			{isMobile && !mobileWarningDismissed && (
				<div className="shrink-0 mx-3 mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center gap-3">
					<ListTodo className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
					<div className="flex-1 min-w-0">
						<p className="text-sm text-yellow-800 dark:text-yellow-200">
							Drag & drop may not work well on mobile.{" "}
							<a href="#/tasks" className="underline font-medium">Use Tasks page</a> for better experience.
						</p>
					</div>
					<button
						type="button"
						onClick={dismissMobileWarning}
						className="shrink-0 p-1 text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
			)}

			{/* Fixed Header with New Task button */}
			<div className="shrink-0 p-3 sm:p-6 pb-0">
				<div className="mb-3 sm:mb-4 flex items-center justify-between gap-2 sm:gap-4">
					<h1 className="text-xl sm:text-2xl font-bold truncate">Kanban Board</h1>
					<div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
						{/* Batch Archive Dropdown */}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" size="default" className="gap-1 sm:gap-2 px-2 sm:px-4">
									<Archive className="w-4 h-4" />
									<span className="hidden sm:inline">Batch Archive</span>
									<ChevronDown className="w-3 h-3" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{BATCH_ARCHIVE_OPTIONS.map((option) => {
									const count = getDoneTasksCount(option.value);
									return (
										<DropdownMenuItem
											key={option.value}
											onClick={() => handleBatchArchive(option.value, option.label)}
											disabled={count === 0}
										>
											<span className="flex-1">Done before {option.label}</span>
											<span className="ml-2 text-xs text-muted-foreground">
												({count})
											</span>
										</DropdownMenuItem>
									);
								})}
							</DropdownMenuContent>
						</DropdownMenu>
						{/* New Task Button */}
						<Button
							onClick={onNewTask}
							className="bg-green-700 hover:bg-green-800 text-white px-2 sm:px-4"
						>
							<Plus className="w-4 h-4 sm:mr-2" />
							<span className="hidden sm:inline">New Task</span>
						</Button>
					</div>
				</div>
			</div>

			{/* Board with scrollable columns */}
			<div className="flex-1 overflow-hidden px-3 sm:px-6 pb-3 sm:pb-6">
				<Board tasks={tasks} loading={loading} onTasksUpdate={onTasksUpdate} />
			</div>
		</div>
	);
}
