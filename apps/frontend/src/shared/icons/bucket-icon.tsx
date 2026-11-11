/** An S3 bucket: a tapered pail with a rim, drawn to sit beside DockerIcon. */
export const BucketIcon = ({ className }: { className?: string }) => {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#a78bfa"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <ellipse
        cx="12"
        cy="5.5"
        rx="8"
        ry="2.5"
        fill="#a78bfa"
        fillOpacity={0.15}
      />
      <path d="M4 5.5 6 19c.2 1.4 2.8 2.5 6 2.5s5.8-1.1 6-2.5l2-13.5" />
      <path d="M5.2 13.5c1.4.9 3.9 1.5 6.8 1.5s5.4-.6 6.8-1.5" />
    </svg>
  );
};
