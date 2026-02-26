import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useMemo,
  useState,
  useEffect,
  lazy,
  Suspense,
  type ReactNode,
  Component,
  type ErrorInfo,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";
import { ClipboardCheck, FileText, AlertTriangle, RefreshCw, Check, Loader2 } from "lucide-react";
import { useTheme } from "../../App";
import { getTask, getDoc } from "../../api/client";
import { cn } from "../../lib/utils";

// Lazy load MermaidBlock for better performance
const MermaidBlock = lazy(() => import("./MermaidBlock"));

// Loading fallback for Mermaid
function MermaidLoading() {
  return (
    <div className="my-4 p-4 rounded-lg border bg-muted/30 animate-pulse">
      <div className="h-32 flex items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading diagram...
      </div>
    </div>
  );
}

/**
 * Error boundary to catch render errors in markdown content
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

class MarkdownErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Markdown render error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-2">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-medium">Failed to render markdown</span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {this.state.error?.message || "An error occurred while rendering the content."}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-muted hover:bg-muted/80 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try again
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

export interface MDRenderRef {
  getElement: () => HTMLElement | null;
}

interface MDRenderProps {
  markdown: string;
  className?: string;
  onDocLinkClick?: (path: string) => void;
  onTaskLinkClick?: (taskId: string) => void;
}

// Regex patterns for mentions
// Task: supports both numeric IDs (task-42, task-42.1) and alphanumeric IDs (task-pdyd2e, task-4sv3rh)
const TASK_MENTION_REGEX = /@(task-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)?)/g;
// Doc: excludes trailing punctuation (comma, semicolon, colon, etc.)
const DOC_MENTION_REGEX = /@docs?\/([^\s,;:!?"'()]+)/g;

/**
 * Normalize doc path - ensure .md extension
 */
function normalizeDocPath(path: string): string {
  return path.endsWith(".md") ? path : `${path}.md`;
}

/**
 * Transform mention patterns into markdown links
 * These will then be styled via the custom link component
 * IMPORTANT: Skip code blocks to avoid breaking mermaid/code syntax
 */
function transformMentions(content: string): string {
  // Split by fenced code blocks (```...```) and inline code (`...`)
  // We only transform text outside of code blocks
  const parts: string[] = [];
  let lastIndex = 0;

  // Match fenced code blocks (```...```) and inline code (`...`)
  // Fenced blocks: ```language\n...\n```
  // Inline code: `...`
  const codeBlockRegex = /(```[\s\S]*?```|`[^`\n]+`)/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add text before this code block (transform it)
    if (match.index > lastIndex) {
      parts.push(transformMentionsInText(content.slice(lastIndex, match.index)));
    }
    // Add code block as-is (don't transform)
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last code block
  if (lastIndex < content.length) {
    parts.push(transformMentionsInText(content.slice(lastIndex)));
  }

  return parts.join("");
}

/**
 * Transform mentions in regular text (not code)
 */
function transformMentionsInText(text: string): string {
  // Transform @task-123 to [@@task-123](#/tasks/task-123)
  let transformed = text.replace(TASK_MENTION_REGEX, "[@@$1](#/tasks/$1)");

  // Transform @doc/path or @docs/path to [@@doc/path.md](#/docs/path.md)
  transformed = transformed.replace(DOC_MENTION_REGEX, (_match, docPath) => {
    // Strip trailing dot if not part of extension (e.g., "@doc/api." → "api")
    let cleanPath = docPath;
    if (cleanPath.endsWith(".") && !cleanPath.match(/\.\w+$/)) {
      cleanPath = cleanPath.slice(0, -1);
    }
    const normalizedPath = normalizeDocPath(cleanPath);
    return `[@@doc/${normalizedPath}](#/docs/${normalizedPath})`;
  });

  return transformed;
}

// Status colors for task badges
const STATUS_STYLES: Record<string, string> = {
  todo: "bg-muted-foreground/50",
  "in-progress": "bg-yellow-500",
  "in-review": "bg-purple-500",
  blocked: "bg-red-500",
  done: "bg-green-500",
};

// Badge classes for mentions
// Uses same styling as shadcn Badge variant="outline" with custom colors
const taskBadgeClass =
  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-sm font-medium transition-colors cursor-pointer select-none border border-green-500/30 bg-green-500/10 text-green-700 hover:bg-green-500/20 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20";

const taskBadgeBrokenClass =
  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-sm font-medium transition-colors cursor-pointer select-none border border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20";

const docBadgeClass =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm font-medium transition-colors cursor-pointer select-none border border-blue-500/30 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20";

const docBadgeBrokenClass =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm font-medium transition-colors cursor-pointer select-none border border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20";

/**
 * Task mention badge that fetches and displays the task title and status
 * Shows red warning style when task is not found
 */
function TaskMentionBadge({
  taskId,
  onTaskLinkClick,
}: {
  taskId: string;
  onTaskLinkClick?: (taskId: string) => void;
}) {
  const [title, setTitle] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const taskNumber = taskId.replace("task-", "");

  useEffect(() => {
    let cancelled = false;

    // API uses just the number, not "task-33"
    getTask(taskNumber)
      .then((task) => {
        if (!cancelled) {
          setTitle(task.title);
          setStatus(task.status);
          setNotFound(false);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTitle(null);
          setStatus(null);
          setNotFound(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [taskNumber]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Don't navigate if task not found
    if (notFound) return;
    if (onTaskLinkClick) {
      onTaskLinkClick(taskNumber);
    } else {
      window.location.hash = `/kanban/${taskNumber}`;
    }
  };

  const statusStyle = status
    ? STATUS_STYLES[status] || STATUS_STYLES.todo
    : null;

  // Use red styling for broken refs
  const badgeClass = notFound ? taskBadgeBrokenClass : taskBadgeClass;

  return (
    <span
      role={notFound ? undefined : "link"}
      className={`${badgeClass} ${notFound ? "cursor-not-allowed" : ""}`}
      data-task-id={taskNumber}
      onClick={handleClick}
      title={notFound ? `Task not found: ${taskNumber}` : undefined}
    >
      {notFound ? (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
      )}
      {loading ? (
        <span className="opacity-70">#{taskNumber}</span>
      ) : title ? (
        <>
          <span className="max-w-[200px] truncate">
            #{taskNumber}: {title}
          </span>
          {statusStyle && (
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusStyle}`} />
          )}
        </>
      ) : (
        <span>#{taskNumber}</span>
      )}
    </span>
  );
}

/**
 * Doc mention badge that fetches and displays the doc title
 * Shows red warning style when doc is not found
 */
function DocMentionBadge({
  docPath,
  onDocLinkClick,
}: {
  docPath: string;
  onDocLinkClick?: (path: string) => void;
}) {
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getDoc(docPath)
      .then((doc) => {
        if (!cancelled && doc) {
          setTitle(doc.title || null);
          setNotFound(false);
          setLoading(false);
        } else if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTitle(null);
          setNotFound(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [docPath]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Don't navigate if doc not found
    if (notFound) return;
    if (onDocLinkClick) {
      onDocLinkClick(docPath);
    } else {
      window.location.hash = `/docs/${docPath}`;
    }
  };

  // Display filename without extension for shorter display
  const shortPath = docPath.replace(/\.md$/, "").split("/").pop() || docPath;

  // Use red styling for broken refs
  const badgeClass = notFound ? docBadgeBrokenClass : docBadgeClass;

  return (
    <span
      role={notFound ? undefined : "link"}
      className={`${badgeClass} ${notFound ? "cursor-not-allowed" : ""}`}
      data-doc-path={docPath}
      onClick={handleClick}
      title={notFound ? `Document not found: ${docPath}` : undefined}
    >
      {notFound ? (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <FileText className="w-3.5 h-3.5 shrink-0" />
      )}
      {loading ? (
        <span className="opacity-70">{shortPath}</span>
      ) : title ? (
        <span className="max-w-[200px] truncate">{title}</span>
      ) : (
        <span className="max-w-[200px] truncate">{shortPath}</span>
      )}
    </span>
  );
}

/**
 * Read-only markdown renderer with mention badge support
 */
const MDRender = forwardRef<MDRenderRef, MDRenderProps>(
  ({ markdown, className = "", onDocLinkClick, onTaskLinkClick }, ref) => {
    const { isDark } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);

    // Transform mentions in the markdown content
    const transformedMarkdown = useMemo(() => {
      return transformMentions(markdown || "");
    }, [markdown]);

    // Expose ref methods
    useImperativeHandle(ref, () => ({
      getElement: () => containerRef.current,
    }));

    // Custom components for react-markdown
    const components = useMemo(
      () => ({
        // Custom link component that renders mention badges
        a: ({ href, children }: { href?: string; children?: ReactNode }) => {
          const text = String(children);

          // Check if this is a task mention (starts with @@task-)
          if (text.startsWith("@@task-")) {
            const taskId = text.slice(2); // Remove @@
            return (
              <TaskMentionBadge
                taskId={taskId}
                onTaskLinkClick={onTaskLinkClick}
              />
            );
          }

          // Check if this is a doc mention (starts with @@doc/)
          if (text.startsWith("@@doc/")) {
            const docPath = text.slice(6); // Remove @@doc/
            return (
              <DocMentionBadge
                docPath={docPath}
                onDocLinkClick={onDocLinkClick}
              />
            );
          }

          // Regular link
          return (
            <a href={href} className="text-primary hover:underline">
              {children}
            </a>
          );
        },

        // Custom code component that handles mermaid blocks and syntax highlighting
        code: ({
          className: codeClassName,
          children,
          node,
          ...props
        }: {
          className?: string;
          children?: ReactNode;
          node?: unknown;
        }) => {
          const match = /language-(\w+)/.exec(codeClassName || "");
          const language = match?.[1];
          const codeContent = String(children).replace(/\n$/, "");

          // Check if this is inline code (no language and single line without newlines)
          const isInline = !language && !String(children).includes("\n");

          // Inline code
          if (isInline) {
            return (
              <code
                className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            );
          }

          // Handle mermaid code blocks (lazy loaded)
          if (language === "mermaid") {
            // Use code hash as key to ensure stable identity
            const key = `mermaid-${codeContent.length}-${codeContent.slice(0, 50).replace(/\s/g, '')}`;
            return (
              <Suspense key={key} fallback={<MermaidLoading />}>
                <MermaidBlock code={codeContent} />
              </Suspense>
            );
          }

          // Block code with syntax highlighting using highlight.js
          let highlightedCode: string;
          try {
            if (language && hljs.getLanguage(language)) {
              highlightedCode = hljs.highlight(codeContent, { language }).value;
            } else {
              highlightedCode = hljs.highlightAuto(codeContent).value;
            }
          } catch {
            highlightedCode = codeContent;
          }

          return (
            <code
              className={`hljs ${language ? `language-${language}` : ""}`}
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          );
        },

        // Custom pre to wrap code blocks
        pre: ({ children, ...props }: { children?: ReactNode }) => {
          return (
            <pre
              className="p-4 rounded-lg overflow-x-auto text-sm hljs-pre"
              {...props}
            >
              {children}
            </pre>
          );
        },

        // Custom input for checkboxes (task lists)
        input: ({
          type,
          checked,
          disabled,
          ...props
        }: {
          type?: string;
          checked?: boolean;
          disabled?: boolean;
        }) => {
          if (type === "checkbox") {
            return (
              <span
                className={cn(
                  "inline-flex items-center justify-center h-4 w-4 shrink-0 rounded-sm border mr-2 align-text-bottom",
                  checked
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-muted-foreground/50"
                )}
                aria-checked={checked}
                role="checkbox"
              >
                {checked && <Check className="h-3 w-3" />}
              </span>
            );
          }
          return <input type={type} checked={checked} disabled={disabled} {...props} />;
        },

        // Custom li for task list items (remove bullet)
        li: ({
          children,
          className,
          ...props
        }: {
          children?: ReactNode;
          className?: string;
        }) => {
          const isTaskListItem = className?.includes("task-list-item");
          return (
            <li
              className={cn(
                className,
                isTaskListItem && "list-none ml-0 flex items-start gap-0"
              )}
              {...props}
            >
              {children}
            </li>
          );
        },

        // Custom ul for task lists (remove padding for task lists)
        ul: ({
          children,
          className,
          ...props
        }: {
          children?: ReactNode;
          className?: string;
        }) => {
          const isTaskList = className?.includes("contains-task-list");
          return (
            <ul
              className={cn(
                className,
                isTaskList && "list-none pl-0"
              )}
              {...props}
            >
              {children}
            </ul>
          );
        },

        // Custom table components for better styling with copy button
        table: ({ children, ...props }: { children?: ReactNode }) => {
          const [copied, setCopied] = useState(false);
          const tableRef = useRef<HTMLTableElement>(null);

          const handleCopyTable = () => {
            if (!tableRef.current) return;

            // Convert table to markdown
            const rows = tableRef.current.querySelectorAll("tr");
            const markdownRows: string[] = [];

            rows.forEach((row, rowIndex) => {
              const cells = row.querySelectorAll("th, td");
              const cellTexts = Array.from(cells).map((cell) => cell.textContent?.trim() || "");
              markdownRows.push(`| ${cellTexts.join(" | ")} |`);

              // Add separator after header row
              if (rowIndex === 0) {
                markdownRows.push(`| ${cellTexts.map(() => "---").join(" | ")} |`);
              }
            });

            const markdown = markdownRows.join("\n");
            navigator.clipboard.writeText(markdown).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          };

          return (
            <div className="table-wrapper group relative my-4 overflow-x-auto rounded-lg border border-border">
              <button
                type="button"
                onClick={handleCopyTable}
                className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-muted hover:bg-muted/80 border border-border text-muted-foreground hover:text-foreground"
                title="Copy as Markdown"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <ClipboardCheck className="w-4 h-4" />}
              </button>
              <table ref={tableRef} className="w-full border-collapse text-sm" {...props}>
                {children}
              </table>
            </div>
          );
        },

        thead: ({ children, ...props }: { children?: ReactNode }) => (
          <thead className="bg-muted" {...props}>
            {children}
          </thead>
        ),

        tbody: ({ children, ...props }: { children?: ReactNode }) => (
          <tbody className="divide-y divide-border/50" {...props}>
            {children}
          </tbody>
        ),

        tr: ({ children, ...props }: { children?: ReactNode }) => (
          <tr className="hover:bg-muted/50 transition-colors" {...props}>
            {children}
          </tr>
        ),

        th: ({ children, ...props }: { children?: ReactNode }) => (
          <th
            className="px-4 py-3 text-left font-semibold border-b-2 border-border"
            {...props}
          >
            {children}
          </th>
        ),

        td: ({ children, ...props }: { children?: ReactNode }) => (
          <td
            className="px-4 py-3 border-b border-border/30"
            {...props}
          >
            {children}
          </td>
        ),
      }),
      [onDocLinkClick, onTaskLinkClick, isDark]
    );

    if (!markdown) return null;

    return (
      <div
        ref={containerRef}
        className={`md-render-wrapper prose prose-sm dark:prose-invert max-w-none ${className}`}
        data-color-mode={isDark ? "dark" : "light"}
      >
        <MarkdownErrorBoundary>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {transformedMarkdown}
          </ReactMarkdown>
        </MarkdownErrorBoundary>
      </div>
    );
  },
);

MDRender.displayName = "MDRender";

export default MDRender;
