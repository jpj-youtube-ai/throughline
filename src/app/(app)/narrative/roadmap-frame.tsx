"use client";

import { useEffect, useRef, useState } from "react";

// Injected into the (sandboxed, opaque-origin) iframe to report its content height
// to the parent. The parent validates every message before trusting it.
const REPORTER =
  "<script>(function(){function r(){parent.postMessage({__roadmap:'h',height:document.documentElement.scrollHeight},'*');}" +
  "window.addEventListener('load',r);if(window.ResizeObserver){new ResizeObserver(r).observe(document.documentElement);}r();})();</script>";

/**
 * Render an untrusted, LLM-generated roadmap HTML document in a sandboxed iframe
 * that auto-grows to its content (REQ-016). sandbox="allow-scripts" WITHOUT
 * allow-same-origin keeps the frame on an opaque origin — its scripts run but
 * cannot reach the app's cookies/DOM. The only channel is postMessage, which we
 * validate (source identity, message shape, numeric height, clamped).
 */
export function RoadmapFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(420);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const frame = ref.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const data = e.data as { __roadmap?: string; height?: unknown };
      if (data?.__roadmap !== "h" || typeof data.height !== "number") return;
      setHeight(Math.min(Math.max(data.height, 120), 6000));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      title="Project roadmap — journey and what's next"
      sandbox="allow-scripts"
      srcDoc={html + REPORTER}
      scrolling="no"
      className="mb-8 w-full rounded-lg border border-hairline bg-paper"
      style={{ height }}
    />
  );
}
