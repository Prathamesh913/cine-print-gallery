import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Search, Sparkles, User, LogOut, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

interface Props {
  query?: string;
  onQueryChange?: (v: string) => void;
  showSearch?: boolean;
  onFeelingLucky?: () => void;
  variant?: "default" | "auth";
}

export function Header({
  query = "",
  onQueryChange,
  showSearch = true,
  onFeelingLucky,
  variant = "default",
}: Props) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const currentPath = router.state.location.pathname;
  const loginSearch = currentPath !== "/login" ? { redirect: currentPath } : undefined;

  if (variant === "auth") {
    return (
      <header
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{ backgroundColor: "rgba(0,0,0,0.8)" }}
      >
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-4">
          <Link to="/" className="flex shrink-0 items-center gap-2" data-cuelume-hover="tick">
            <FrameIcon />
            <span
              style={{ fontFamily: "Bebas Neue, sans-serif" }}
              className="text-2xl tracking-[0.12em] sm:text-3xl"
            >
              CINEPRINT
            </span>
          </Link>

          <Link
            to="/"
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-white/65 transition-colors duration-150 hoverable:hover:text-white/70 active:scale-95"
          >
            <ArrowLeft size={14} />
            Back to gallery
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header
      className="sticky top-0 z-40 backdrop-blur-md"
      style={{ backgroundColor: "rgba(0,0,0,0.8)" }}
    >
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-4">
        <Link to="/" className="flex shrink-0 items-center gap-2" data-cuelume-hover="tick">
          <FrameIcon />
          <span
            style={{ fontFamily: "Bebas Neue, sans-serif" }}
            className="text-2xl tracking-[0.12em] sm:text-3xl"
          >
            CINEPRINT
          </span>
        </Link>

        {showSearch && (
          <div className="relative mx-auto hidden max-w-md flex-1 md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/55" size={16} />
            <input
              value={query}
              onChange={(e) => onQueryChange?.(e.target.value)}
              placeholder="Search posters, artists, tags…"
              className="w-full rounded-full border border-white/15 bg-white/5 py-2 pl-9 pr-4 text-sm text-[#F5F5F5] placeholder:text-white/55 focus:border-[#FF6B6B] focus:outline-none"
            />
          </div>
        )}

        <nav className="ml-auto flex items-center gap-1 text-sm sm:gap-2">
          {onFeelingLucky && (
            <button
              onClick={onFeelingLucky}
              title="Feeling Lucky? Show a random poster."
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-white/70 transition-[transform,color] duration-150 ease-[var(--ease-out)] hoverable:hover:text-[#FF6B6B] active:scale-95"
            >
              <Sparkles size={16} />
              <span className="hidden sm:inline">Lucky</span>
            </button>
          )}
          <NavLink to="/about">About</NavLink>
          <NavLink to="/submit">Submit</NavLink>
          <NavLink to="/saved">Saved</NavLink>
          {user ? (
            <AlertDialog>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ml-2 transition-opacity duration-150 hoverable:hover:opacity-80 active:scale-95">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || ""}
                        className="h-7 w-7 rounded-full border border-white/15"
                      />
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FF6B6B] text-[10px] font-bold text-[#121212]">
                        {user.displayName?.charAt(0) || user.email?.charAt(0) || "?"}
                      </div>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8}>
                  <DropdownMenuItem onClick={() => navigate({ to: "/profile" })}>
                    <User size={14} />
                    View Profile
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem className="text-red-400 focus:text-red-400">
                      <LogOut size={14} />
                      Log out
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                </DropdownMenuContent>
              </DropdownMenu>

              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Log out</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to log out? You'll need to sign in again to access your
                    saved posters.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-[#F5F5F5] transition-[transform,background-color] duration-150 ease-[var(--ease-out)] hoverable:hover:bg-white/10 active:scale-95">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#FF6B6B] px-5 py-2 text-sm font-medium text-[#121212] transition-[transform,background-color] duration-150 ease-[var(--ease-out)] hoverable:hover:bg-[#FF8585] active:scale-95"
                    onClick={signOut}
                  >
                    Log out
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <NavLink to="/login" search={loginSearch}>
              Login
            </NavLink>
          )}
          {/* <NavLink to="/constellation">Galaxy</NavLink> */}
        </nav>
      </div>

      {showSearch && (
        <div className="px-4 pb-3 md:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/55" size={16} />
            <input
              value={query}
              onChange={(e) => onQueryChange?.(e.target.value)}
              placeholder="Search posters, artists, tags…"
              className="w-full rounded-full border border-white/15 bg-white/5 py-2 pl-9 pr-4 text-sm text-[#F5F5F5] placeholder:text-white/55 focus:border-[#FF6B6B] focus:outline-none"
            />
          </div>
        </div>
      )}
    </header>
  );
}

function NavLink({
  to,
  search,
  children,
}: {
  to: string;
  search?: Record<string, unknown>;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      search={search}
      data-cuelume-hover="tick"
      className="rounded-full px-3 py-1.5 text-white/70 transition-colors duration-150 hoverable:hover:text-[#F5F5F5]"
      activeProps={{ style: { color: "#FF6B6B" } }}
    >
      {children}
    </Link>
  );
}

function FrameIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FF6B6B"
      strokeWidth="2"
      strokeLinecap="square"
    >
      <path d="M3 3 H9 M3 3 V9" />
      <path d="M21 21 H15 M21 21 V15" />
    </svg>
  );
}
