/* Summy Garden Studio — serve the website, and only the website.
 *
 * THE PROBLEM THIS SOLVES
 * Cloudflare Pages publishes every file in the repository root as a static
 * asset. The repo is not only a website: it also holds database migrations,
 * internal working documents and dead code from the Netlify era. All of it was
 * being served to anyone who asked. Confirmed live, before this file existed:
 *
 *   /migrations/2026-09-04-partners.sql  → full schema, every RLS policy, and
 *                                          the admin email address
 *   /GROUND_RULES.md                     → the production recipe, the engine
 *                                          used, and the per-image cost
 *   /CLOUDFLARE-SETUP.md                 → the name of every secret and how
 *                                          the infrastructure is wired
 *   /checkout.mjs and other root .mjs    → dead Netlify handlers, still readable
 *
 * No secret VALUE was exposed — keys live in environment variables and never in
 * the repo. But the shape of the system, its costs and its method were public,
 * which is a map for anyone who wants to copy or probe it.
 *
 * WHY A DENYLIST BY EXTENSION
 * Blocking the four files found today would leave the same hole open for the
 * fifth. Nothing with these extensions is ever part of a website, so the rule
 * holds for files that do not exist yet — including ones added in a hurry.
 *
 * Middleware runs ahead of static assets, so this intercepts them before Pages
 * serves anything. Functions under /api/ are reached through next() as usual.
 */

// Never web content. A .md is a document, a .sql is a migration, a .toml is
// configuration — none of them belong to a visitor.
const BLOCKED_EXT = [
  ".md", ".sql", ".toml", ".mjs", ".yml", ".yaml",
  ".lock", ".bat", ".sh", ".ps1", ".env", ".ini", ".log", ".bak",
];

// Whole directories that exist for the repository, not the site.
const BLOCKED_DIR = ["/migrations/", "/.git/", "/.github/", "/node_modules/"];

// Exact paths that carry no extension clue of their own.
const BLOCKED_FILE = ["/package.json", "/package-lock.json", "/netlify.toml", "/.gitignore"];

/* Kept deliberately: robots.txt, llms.txt and sitemap.xml are published on
   purpose — they are how search engines and AI crawlers read the site, and
   blocking them would undo the visibility work. .html, images, .css and .js
   are the site itself and are never matched by the lists above. */

function isPrivate(pathname) {
  const p = pathname.toLowerCase();
  if (BLOCKED_DIR.some((d) => p.startsWith(d))) return true;
  if (BLOCKED_FILE.includes(p)) return true;
  return BLOCKED_EXT.some((e) => p.endsWith(e));
}

export async function onRequest(context) {
  const { request, next } = context;
  const { pathname } = new URL(request.url);

  if (isPrivate(pathname)) {
    /* A plain 404, not a 403. A 403 would confirm that something is there and
       invite a closer look; as far as the internet is concerned these paths
       simply do not exist. */
    return new Response("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  return await next();
}
