import React from 'react';

const RightSidebarIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="1.5" y="2" width="13" height="12" rx="2" />
    <line x1="10.5" y1="2" x2="10.5" y2="14" />
  </svg>
);

export default RightSidebarIcon;
