import type { SVGProps } from "react";

// One line-icon family: 24px box, 1.6 stroke, round caps. No emoji as icons.
function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

// The Throughline mark: a spine with two nodes — the causal thread itself.
export function Mark(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3.5v17" />
      <circle cx="12" cy="7" r="2.4" />
      <circle cx="12" cy="17" r="2.4" />
    </Svg>
  );
}

export function PulseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M2 12h3.5l2.2-6.5L12 18l2.2-6h2.3" />
      <circle cx="19" cy="12" r="1.3" />
    </Svg>
  );
}

export function IdeaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l1.7 5.8 5.8 1.7-5.8 1.7L12 18.5l-1.7-5.8L4.5 11l5.8-1.7z" />
    </Svg>
  );
}

export function TaskIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2.2" />
      <path d="M8.3 12.4l2.4 2.4 4.9-5.6" />
    </Svg>
  );
}

export function DriftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 4.2l8.5 14.8H3.5z" />
      <path d="M12 10.2v3.6" />
      <path d="M12 16.6h.01" />
    </Svg>
  );
}

export function DigestIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3.5 11.5L20.5 4l-7.5 16.5-2.2-7.3z" />
      <path d="M20.5 4l-9.7 8.7" />
    </Svg>
  );
}

export function WhyQualityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 5h11M4 10h7M4 15h9" />
      <circle cx="16.5" cy="15.5" r="3" />
      <path d="M18.8 17.8L21 20" />
    </Svg>
  );
}

export function ReconcileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="6.5" cy="6.5" r="2.4" />
      <circle cx="17.5" cy="17.5" r="2.4" />
      <path d="M6.5 8.9v4.6a4 4 0 004 4h2.6M17.5 15.1v-4.6a4 4 0 00-4-4h-2.6" />
    </Svg>
  );
}

export function HeartbeatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M5 14v4M9.5 9v9M14 5v13M18.5 11v7" />
    </Svg>
  );
}

export function QuickWinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M13 3L5 13h6l-1 8 8-10h-6z" />
    </Svg>
  );
}

export function PipelineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="12" r="2.2" />
      <path d="M8.2 6h4.3a3 3 0 013 3v.8M8.2 18h4.3a3 3 0 003-3v-.8" />
    </Svg>
  );
}

export function ProgressIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 17l5.5-5.5 3.5 3.5L21 6" />
      <path d="M21 11V6h-5" />
    </Svg>
  );
}

export function NarrativeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 6.4C10.4 5.1 7.6 4.6 4.5 5v13c3.1-.4 5.9.1 7.5 1.4 1.6-1.3 4.4-1.8 7.5-1.4V5c-3.1-.4-5.9.1-7.5 1.4z" />
      <path d="M12 6.4V18.4" />
    </Svg>
  );
}

export function SpecIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </Svg>
  );
}

export function ArrowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}
