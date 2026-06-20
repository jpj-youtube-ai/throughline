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

export function ReconcileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="6.5" cy="6.5" r="2.4" />
      <circle cx="17.5" cy="17.5" r="2.4" />
      <path d="M6.5 8.9v4.6a4 4 0 004 4h2.6M17.5 15.1v-4.6a4 4 0 00-4-4h-2.6" />
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
