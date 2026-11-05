import { Link } from "@tanstack/react-router";

interface Props {
  slug: string;
  name: string;
}

/**
 * Visible breadcrumb for artist detail pages: Home → Artists → name.
 * Matches the BreadcrumbList JSON-LD emitted for the same page.
 */
export function ArtistBreadcrumb({ slug, name }: Props) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-white/45">
        <li>
          <Link to="/" preload="intent" className="transition-colors hover:text-white/80">
            Home
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link to="/artists" preload="intent" className="transition-colors hover:text-white/80">
            Artists
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="min-w-0 max-w-[40ch] truncate text-white/85">
          {name}
        </li>
      </ol>
    </nav>
  );
}
