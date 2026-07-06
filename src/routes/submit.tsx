import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Sparkles, Palette, Check, ArrowRight } from "lucide-react";
import { submitPosterToNotion } from "@/lib/notion";

export const Route = createFileRoute("/submit")({
  head: () => ({
    meta: [
      { title: "Submit Poster Artwork — CinePrint Gallery" },
      { name: "description", content: "Submit your custom alternative movie poster illustrations or recommend fan-made movie designs to the CinePrint archive." },
    ],
  }),
  component: Submit,
});

function Submit() {
  const [role, setRole] = useState<"fan" | "artist">("fan");
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    artistName: "",
    image: "",
    source: "",
    portfolio: "",
    socials: "",
    note: "",
    isCopyrightConfirmed: false,
  });

  const update = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const val = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm((f) => ({ ...f, [k]: val }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, isCopyrightConfirmed: e.target.checked }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await submitPosterToNotion({
        data: {
          role,
          ...form,
        },
      });
      setDone(true);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to submit poster. Please check your inputs or try again later.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setDone(false);
    setErrorMsg(null);
    setForm({
      title: "",
      artistName: "",
      image: "",
      source: "",
      portfolio: "",
      socials: "",
      note: "",
      isCopyrightConfirmed: false,
    });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header showSearch={false} />
      <main className="mx-auto w-full max-w-xl px-6 py-16 flex-grow flex flex-col justify-center">
        <span style={{ fontFamily: "Bebas Neue, sans-serif", color: "#FF6B6B" }} className="text-sm tracking-[0.3em]">
          SUBMIT ALTERNATIVE ART
        </span>
        <h1 style={{ fontFamily: "Poppins, sans-serif" }} className="mt-2 text-3xl font-semibold sm:text-4xl">
          {role === "fan" ? "Submit Custom Movie Poster Designs" : "Showcase Your Fan-Made Film Art"}
        </h1>
        <p className="mt-3 text-white/60 text-sm">
          {role === "fan"
            ? "Discovered alternative movie posters or custom print illustrations you love? Share them with us, and we'll credit the original poster artist in our archive."
            : "Are you an independent graphic designer or illustrator? Submit your own alternative movie posters and vector designs directly to our curated gallery."}
        </p>

        {/* Role Selector Toggle */}
        <div className="mt-6 flex rounded-full bg-white/5 p-1 border border-white/10">
          <button
            type="button"
            onClick={() => setRole("fan")}
            className={`flex-grow flex items-center justify-center gap-2 rounded-full py-2.5 text-xs font-bold tracking-wider transition ${
              role === "fan"
                ? "bg-[#FF6B6B] text-[#121212] shadow-lg shadow-[#FF6B6B]/15"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Sparkles size={12} />
            I'M A FAN
          </button>
          <button
            type="button"
            onClick={() => setRole("artist")}
            className={`flex-grow flex items-center justify-center gap-2 rounded-full py-2.5 text-xs font-bold tracking-wider transition ${
              role === "artist"
                ? "bg-[#FF6B6B] text-[#121212] shadow-lg shadow-[#FF6B6B]/15"
                : "text-white/60 hover:text-white"
            }`}
          >
            <Palette size={12} />
            I'M THE ARTIST
          </button>
        </div>

        {done ? (
          <div className="mt-10 rounded-2xl border border-[#FF6B6B]/20 bg-[#FF6B6B]/5 p-8 text-center shadow-xl backdrop-blur-md">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#FF6B6B]/10 text-[#FF6B6B] mb-4">
              <Check size={24} />
            </div>
            <h3 style={{ fontFamily: "Poppins, sans-serif" }} className="text-lg font-semibold text-[#F5F5F5]">
              Submission Received!
            </h3>
            <p className="mt-2 text-sm text-white/50 leading-relaxed">
              Thanks for sharing! Our team reviews every submission for styling, resolution, and credit details before publishing.
            </p>
            <button
              onClick={resetForm}
              className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-[#FF6B6B] hover:text-[#FF8585] transition"
            >
              Submit another poster
              <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5">
            <Field
              label="Movie or Show Title"
              placeholder="e.g. Pulp Fiction, Interstellar..."
              value={form.title}
              onChange={update("title")}
              required
            />

            {role === "fan" ? (
              <>
                <Field
                  label="Artist Name"
                  placeholder="Who created this poster? (Optional)"
                  value={form.artistName}
                  onChange={update("artistName")}
                />
                <Field
                  label="Image URL"
                  placeholder="Link to the poster image file (Required)"
                  type="url"
                  value={form.image}
                  onChange={update("image")}
                  required
                />
                <Field
                  label="Source URL"
                  placeholder="Where did you find this? e.g. Instagram, Behance (Optional)"
                  type="url"
                  value={form.source}
                  onChange={update("source")}
                />
              </>
            ) : (
              <>
                <Field
                  label="Your Artist Name"
                  placeholder="What is your creator pseudonym? (Required)"
                  value={form.artistName}
                  onChange={update("artistName")}
                  required
                />
                <Field
                  label="Portfolio or Website URL"
                  placeholder="Where can we see your work? e.g. artstation.com (Required)"
                  type="url"
                  value={form.portfolio}
                  onChange={update("portfolio")}
                  required
                />
                <Field
                  label="Social Handles"
                  placeholder="e.g. @username on Instagram or Twitter (Optional)"
                  value={form.socials}
                  onChange={update("socials")}
                />
                <Field
                  label="Image URL of Artwork"
                  placeholder="Link to your high-resolution poster image file (Required)"
                  type="url"
                  value={form.image}
                  onChange={update("image")}
                  required
                />
                
                {/* Copyright Confirmation Checkbox */}
                <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/2 px-4 py-3">
                  <input
                    id="isCopyrightConfirmed"
                    type="checkbox"
                    checked={form.isCopyrightConfirmed}
                    onChange={handleCheckboxChange}
                    className="mt-1 h-4 w-4 rounded border-white/10 bg-white/5 text-[#FF6B6B] focus:ring-[#FF6B6B]"
                    required
                  />
                  <label htmlFor="isCopyrightConfirmed" className="text-xs text-white/50 leading-relaxed cursor-pointer select-none">
                    I confirm that <strong className="text-white/80">I am the original creator</strong> of this artwork, and grant CinePrint permission to display it in the gallery.
                  </label>
                </div>
              </>
            )}

            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-widest text-white/40">Additional Notes</label>
              <textarea
                value={form.note}
                onChange={update("note")}
                placeholder="Any extra context, dimensions, or printing details..."
                rows={3}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-white/30 focus:border-[#FF6B6B] focus:outline-none transition-colors"
              />
            </div>

            {errorMsg && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-center text-xs text-red-400">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-full py-3 text-sm font-semibold transition animate-fade-in disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#FF6B6B", color: "#121212" }}
            >
              {isSubmitting ? "Submitting..." : "Submit Poster"}
            </button>
          </form>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="mb-1.5 block text-xs uppercase tracking-widest text-white/40">{label}</label>
      <input
        {...rest}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-white/30 focus:border-[#FF6B6B] focus:outline-none transition-colors"
      />
    </div>
  );
}
