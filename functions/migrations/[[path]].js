/* Superseded by functions/_middleware.js, which blocks /migrations/ along with
 * every other non-website path by extension rather than folder by folder.
 * Kept as a second layer: if the middleware is ever edited or removed by
 * mistake, this still keeps the database migrations off the public site.
 */
export async function onRequest() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
