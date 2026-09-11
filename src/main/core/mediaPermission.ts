export interface MediaPermissionCheckDetails {
  isMainFrame?: boolean;
  mediaType?: string;
}

export const shouldAllowAudioMediaCheck = (
  isMainWindow: boolean,
  details: MediaPermissionCheckDetails,
): boolean => isMainWindow && details.isMainFrame !== false && details.mediaType !== 'video';

export const shouldAllowAudioMediaRequest = (
  isMainWindow: boolean,
  mediaTypes?: readonly string[],
): boolean =>
  isMainWindow &&
  mediaTypes?.includes('video') !== true &&
  (mediaTypes === undefined || mediaTypes.length === 0 || mediaTypes.includes('audio'));

export interface DisplayMediaRequestDetails {
  audioRequested: boolean;
  authorizedByRenderer: boolean;
  isMainFrame: boolean;
  videoRequested: boolean;
  isWindows: boolean;
}

export const shouldAllowSystemAudioCapture = (details: DisplayMediaRequestDetails): boolean =>
  details.isWindows &&
  details.isMainFrame &&
  details.authorizedByRenderer &&
  details.audioRequested &&
  details.videoRequested;
