import { loadGenreTuneLists, type GenreTuneList } from '../../../lib/genreTunes';

export async function getStaticPaths() {
  const lists = await loadGenreTuneLists();
  return [...lists.values()].map((list) => ({ params: { genre: list.genre }, props: { list } }));
}

export function GET({ props }: { props: { list: GenreTuneList } }) {
  return new Response(JSON.stringify(props.list), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
  });
}
