import { describe, expect, it } from 'vitest';

import { shouldApplyApplicationCsp } from './contentSecurityPolicy';

describe('shouldApplyApplicationCsp', () => {
  it('limits development CSP injection to the application origin', () => {
    const appUrl = 'http://localhost:43127';
    expect(shouldApplyApplicationCsp(`${appUrl}/src/main.tsx`, appUrl, true)).toBe(true);
    expect(shouldApplyApplicationCsp('https://example.com/app.js', appUrl, true)).toBe(false);
  });

  it('limits packaged CSP injection to local application files', () => {
    expect(
      shouldApplyApplicationCsp('file:///C:/Program%20Files/JustDo/index.html', '', false),
    ).toBe(true);
    expect(shouldApplyApplicationCsp('https://example.com/', '', false)).toBe(false);
  });
});
