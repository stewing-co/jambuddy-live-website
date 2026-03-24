import { buildAllCollectionSearchIndex } from '../../lib/abcCollections';

export function GET() {
  return new Response(JSON.stringify(buildAllCollectionSearchIndex()), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
