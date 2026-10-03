import { ABC_COLLECTIONS } from '../../../lib/abcCollections';
import { loadPickerGenres } from '../../../lib/abcLibrary';

// Every genre's collections, loaded by the collection picker when the genre changes.
export async function GET() {
  return new Response(JSON.stringify(await loadPickerGenres(ABC_COLLECTIONS)), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
