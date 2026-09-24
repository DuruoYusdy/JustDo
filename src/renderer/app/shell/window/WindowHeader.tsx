import React from 'react';

import WindowTitleBar from './WindowTitleBar';

/** Shared window chrome, independent of page navigation and scrolling content. */
const WindowHeader: React.FC = () => (
  <div className="draggable flex h-[1.875rem] shrink-0 select-none items-center justify-end border-b border-border px-4">
    <WindowTitleBar inline compact />
  </div>
);

export default WindowHeader;
