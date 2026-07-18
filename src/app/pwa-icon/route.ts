export function GET(request: Request) {
  const accept = request.headers.get('accept') || '';
  const fetchDestination = request.headers.get('sec-fetch-dest') || '';
  const isDocumentRequest = fetchDestination === 'document' || accept.includes('text/html');
  const targetPath = isDocumentRequest ? '/' : '/images/pwa-icon.png';

  return Response.redirect(new URL(targetPath, request.url), 307);
}
