import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/submit")({
  head: () => ({
    meta: [
      { title: "Submit — CinePrint" },
      { name: "description", content: "Suggest a poster for the CinePrint gallery." },
    ],
  }),
  component: Submit,
});

function Submit() {
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ title: "", artist: "", image: "", source: "", note: "" });

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setDone(true);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#121212", color: "#F5F5F5" }}>
      <Header showSearch={false} />
      <main className="mx-auto max-w-xl px-6 py-16">
        <span style={{ fontFamily: "Bebas Neue, sans-serif", color: "#FF6B6B" }} className="text-sm tracking-[0.3em]">
          SUBMIT A POSTER
        </span>
        <h1 style={{ fontFamily: "Poppins, sans-serif" }} className="mt-2 text-3xl font-semibold sm:text-4xl">
          Found something brilliant?
        </h1>
        <p className="mt-3 text-white/60">
          Send us a poster you love. We curate every submission by hand.
        </p>

        {done ? (
          <div className="mt-10 rounded-lg border border-[#FF6B6B]/40 bg-[#FF6B6B]/10 p-6 text-center">
            <p className="text-lg text-[#F5F5F5]">Thanks — we'll take a look.</p>
            <button
              onClick={() => { setDone(false); setForm({ title: "", artist: "", image: "", source: "", note: "" }); }}
              className="mt-3 text-sm text-[#FF6B6B] underline underline-offset-4"
            >
              Submit another
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Movie or show title" value={form.title} onChange={update("title")} required />
            <Field label="Artist name" value={form.artist} onChange={update("artist")} required />
            <Field label="Image URL" value={form.image} onChange={update("image")} type="url" required />
            <Field label="Source URL" value={form.source} onChange={update("source")} type="url" />
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-widest text-white/50">Note</label>
              <textarea
                value={form.note}
                onChange={update("note")}
                rows={3}
                className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm focus:border-[#FF6B6B] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-full px-4 py-3 text-sm font-medium transition"
              style={{ backgroundColor: "#FF6B6B", color: "#121212" }}
            >
              Send it our way
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
      <label className="mb-1.5 block text-xs uppercase tracking-widest text-white/50">{label}</label>
      <input
        {...rest}
        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm focus:border-[#FF6B6B] focus:outline-none"
      />
    </div>
  );
}
