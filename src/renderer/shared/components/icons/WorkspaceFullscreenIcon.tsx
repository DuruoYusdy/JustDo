import React from 'react';

interface WorkspaceFullscreenIconProps {
  className?: string;
  expanded?: boolean;
}

const WorkspaceFullscreenIcon: React.FC<WorkspaceFullscreenIconProps> = ({
  className,
  expanded = false,
}) => (
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
    {expanded ? (
      <>
        <path d="M13.5 6.25H9.75V2.5" />
        <path d="M9.75 6.25 13.5 2.5" />
        <path d="M2.5 9.75h3.75v3.75" />
        <path d="M6.25 9.75 2.5 13.5" />
      </>
    ) : (
      <>
        <path d="M9.75 2.5h3.75v3.75" />
        <path d="M13.5 2.5 9.75 6.25" />
        <path d="M6.25 13.5H2.5V9.75" />
        <path d="M2.5 13.5 6.25 9.75" />
      </>
    )}
  </svg>
);

export default WorkspaceFullscreenIcon;
