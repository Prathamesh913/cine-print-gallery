import { createFileRoute, Link } from "@tanstack/react-router";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — CinePrint" },
      {
        name: "description",
        content: "How CinePrint handles sign-in, saved posters, and your data.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: "#000000", color: "#F5F5F5" }}
    >
      <Header showSearch={false} />
      <main className="mx-auto w-full max-w-2xl flex-grow px-6 py-16">
        <span
          className="text-sm uppercase tracking-[0.3em] font-display text-[#FF6B6B]"
        >
          Legal
        </span>
        <h1
          className="mt-2 text-3xl font-bold sm:text-4xl font-heading"
        >
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-white/65">Last updated: July 25, 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-white/70">
          <section>
            <h2 className="text-base font-semibold text-white/90">What we collect</h2>
            <p className="mt-2">
              When you sign in with Google, we receive your Google account identifier, email
              address, display name, and profile photo. We use this to create your CinePrint profile
              and keep you signed in.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white/90">How we use your data</h2>
            <p className="mt-2">
              We store posters you save (likes) so you can access them across devices. We do not
              sell your personal information. CinePrint is a non-commercial fan project.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white/90">Authentication</h2>
            <p className="mt-2">
              Sign-in is handled by Google via Firebase Authentication. We do not store your Google
              password. You can revoke access anytime from your Google account settings.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white/90">Third parties</h2>
            <p className="mt-2">
              We rely on Google (sign-in) and Firebase (auth and data storage). Their privacy
              policies apply to data processed by those services.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white/90">Contact</h2>
            <p className="mt-2">
              Questions about your data, or requests to remove your account or artwork, can be sent
              via the contact options on our{" "}
              <Link
                to="/about"
                className="text-[#FF6B6B] underline underline-offset-2 transition-colors duration-150 hoverable:hover:text-[#FF8585]"
              >
                About
              </Link>{" "}
              page.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
