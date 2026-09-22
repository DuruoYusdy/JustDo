import { net, protocol } from 'electron';

export const registerLocalFileProtocol = (): void => {
  // Three slashes needed: localfile:///C:/Users/... gives pathname /C:/Users/...
  protocol.handle('localfile', request => {
    const url = new URL(request.url);
    // Keep escaped filename characters and the UNC host intact. Only the drive
    // separator needs decoding for file: URLs generated from Windows paths.
    const pathname = url.pathname.replace(/^\/([A-Za-z])%3A(?=\/)/i, '/$1:');
    return net.fetch(`file://${url.host}${pathname}`);
  });
};
