import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import mermaid from "mermaid";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  X,
  Copy,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";
import { useTheme } from "../../App";

interface MermaidBlockProps {
  code: string;
}

let mermaidInitialized = false;
let currentTheme: "dark" | "default" = "default";

function initMermaid(isDark: boolean) {
  const theme = isDark ? "dark" : "default";
  if (mermaidInitialized && currentTheme === theme) return;

  mermaid.initialize({
    startOnLoad: false,
    theme: theme,
    securityLevel: "loose",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    themeVariables: isDark
      ? {
          primaryColor: "#3d4144",
          primaryTextColor: "#c9d1d9",
          primaryBorderColor: "#6e7681",
          lineColor: "#8b949e",
          secondaryColor: "#21262d",
          tertiaryColor: "#161b22",
          background: "#0d1117",
          mainBkg: "#0d1117",
          nodeBorder: "#6e7681",
          clusterBkg: "#21262d",
          titleColor: "#c9d1d9",
          edgeLabelBackground: "#0d1117",
        }
      : {},
  });
  mermaidInitialized = true;
  currentTheme = theme;
}

const ZOOM_STEP = 0.2;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const PAN_STEP = 50;

// Button component for controls
function ControlButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="p-2 rounded-md bg-[#21262d]/90 hover:bg-[#30363d] border border-[#30363d] transition-colors disabled:opacity-40 backdrop-blur-sm"
      title={title}
    >
      {children}
    </button>
  );
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { isDark } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  // Handlers
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM)), []);
  const handleReset = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handlePan = useCallback((dir: "up" | "down" | "left" | "right") => {
    setPosition((p) => ({
      x: p.x + (dir === "left" ? PAN_STEP : dir === "right" ? -PAN_STEP : 0),
      y: p.y + (dir === "up" ? PAN_STEP : dir === "down" ? -PAN_STEP : 0),
    }));
  }, []);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  // Wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !svg) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP))));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svg]);

  // ESC to close fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // Render mermaid
  useEffect(() => {
    if (!code) return;
    initMermaid(isDark);
    (async () => {
      try {
        const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`;
        const { svg: rendered } = await mermaid.render(id, code.trim());
        setSvg(rendered);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to render");
        setSvg(null);
      }
    })();
  }, [code, isDark]);

  if (error) {
    return (
      <div className="my-4 p-4 rounded-lg border border-red-500/30 bg-red-500/10">
        <div className="text-sm text-red-600 dark:text-red-400 mb-2">Mermaid Error: {error}</div>
        <pre className="text-xs overflow-auto p-2 bg-muted rounded"><code>{code}</code></pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 p-4 rounded-lg border bg-[#0d1117] animate-pulse">
        <div className="h-32 flex items-center justify-center text-[#8b949e]">Loading diagram...</div>
      </div>
    );
  }

  // Controls overlay
  const controls = (
    <>
      {/* Top-right: Fullscreen + Copy */}
      <div className="absolute top-3 right-3 flex gap-1 z-20">
        {!isFullscreen && (
          <ControlButton onClick={() => setIsFullscreen(true)} title="Fullscreen">
            <Maximize2 className="w-4 h-4 text-[#8b949e]" />
          </ControlButton>
        )}
        {isFullscreen && (
          <ControlButton onClick={() => setIsFullscreen(false)} title="Close">
            <X className="w-4 h-4 text-[#8b949e]" />
          </ControlButton>
        )}
        <ControlButton onClick={handleCopy} title="Copy code">
          {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-[#8b949e]" />}
        </ControlButton>
      </div>

      {/* Bottom-right: D-pad + Zoom */}
      <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1 z-20">
        <div className="flex gap-1">
          <ControlButton onClick={() => handlePan("up")} title="Pan up">
            <ChevronUp className="w-4 h-4 text-[#8b949e]" />
          </ControlButton>
          <ControlButton onClick={handleZoomIn} disabled={zoom >= MAX_ZOOM} title="Zoom in">
            <ZoomIn className="w-4 h-4 text-[#8b949e]" />
          </ControlButton>
        </div>
        <div className="flex gap-1">
          <ControlButton onClick={() => handlePan("left")} title="Pan left">
            <ChevronLeft className="w-4 h-4 text-[#8b949e]" />
          </ControlButton>
          <ControlButton onClick={handleReset} title="Reset view">
            <RotateCcw className="w-4 h-4 text-[#8b949e]" />
          </ControlButton>
          <ControlButton onClick={() => handlePan("right")} title="Pan right">
            <ChevronRight className="w-4 h-4 text-[#8b949e]" />
          </ControlButton>
        </div>
        <div className="flex gap-1">
          <ControlButton onClick={() => handlePan("down")} title="Pan down">
            <ChevronDown className="w-4 h-4 text-[#8b949e]" />
          </ControlButton>
          <ControlButton onClick={handleZoomOut} disabled={zoom <= MIN_ZOOM} title="Zoom out">
            <ZoomOut className="w-4 h-4 text-[#8b949e]" />
          </ControlButton>
        </div>
      </div>
    </>
  );

  // Diagram element
  const diagram = (
    <div
      className="mermaid-diagram [&_svg]:max-w-none"
      style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})` }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );

  // Fullscreen modal via portal
  if (isFullscreen) {
    return createPortal(
      <div
        className="fixed inset-0 bg-[#0d1117] flex items-center justify-center"
        style={{ zIndex: 99999 }}
        onClick={(e) => e.target === e.currentTarget && setIsFullscreen(false)}
      >
        <div ref={containerRef} className="relative w-full h-full flex items-center justify-center overflow-hidden">
          {diagram}
          {controls}
          <div className="absolute top-3 left-3 text-xs text-[#8b949e] bg-[#21262d]/90 px-2 py-1 rounded border border-[#30363d] z-20">
            ESC to close
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // Normal inline view
  return (
    <div className="mermaid-wrapper my-4 rounded-lg border overflow-hidden relative">
      <div
        ref={containerRef}
        className="mermaid-container bg-[#0d1117] overflow-hidden flex items-center justify-center"
        style={{ minHeight: "200px" }}
      >
        {diagram}
      </div>
      {controls}
    </div>
  );
}

export default MermaidBlock;
