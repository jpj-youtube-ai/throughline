"use client";

import { useEffect, useRef, useState } from "react";

// Injected into the (sandboxed, opaque-origin) iframe to report its content
// height to the parent. The parent validates every message before trusting it.
const REPORTER =
  "<script>(function(){function r(){parent.postMessage({__hf:'h',height:document.documentElement.scrollHeight},'*');}" +
  "window.addEventListener('load',r);if(window.ResizeObserver){new ResizeObserver(r).observe(document.documentElement);}r();})();</script>";

/**
 * Render an untrusted, LLM-generated HTML document in a sandboxed iframe that
 * auto-grows to its content. sandbox="allow-scripts" WITHOUT allow-same-origin
 * keeps the frame on an opaque origin — its scripts run but cannot reach the
 * app's cookies/DOM. The only channel is postMessage, which we validate
 * (source identity, message shape, numeric height, clamped).
 */
export function HtmlFrame({ html, title, className = "" }: { html: string; title: string; className?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(420);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const frame = ref.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const data = e.data as { __hf?: string; height?: unknown };
      if (data?.__hf !== "h" || typeof data.height !== "number") return;
      setHeight(Math.min(Math.max(data.height, 120), 6000));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts"
      srcDoc={html + REPORTER}
      scrolling="no"
      className={`w-full rounded-lg border border-hairline bg-paper ${className}`}
      style={{ height }}
    />
  );
}
