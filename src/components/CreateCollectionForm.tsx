import { useState } from "react";
import { FolderPlus, Globe, Link2, Lock, Loader2 } from "lucide-react";
import type { CollectionVisibility } from "@/lib/collections";

const visibilityMeta: Record<
  CollectionVisibility,
  { label: string; hint: string; icon: typeof Lock }
> = {
  private: { label: "Private", hint: "Only you", icon: Lock },
  unlisted: { label: "Unlisted", hint: "Anyone with the link", icon: Link2 },
  public: { label: "Public", hint: "Discoverable", icon: Globe },
};

interface Props {
  onSubmit: (input: {
    name: string;
    description?: string;
    visibility: CollectionVisibility;
  }) => Promise<boolean>;
  submitLabel?: string;
}

export function CreateCollectionForm({ onSubmit, submitLabel = "Create collection" }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<CollectionVisibility>("private");
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || creating) return;

    setCreating(true);
    const ok = await onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      visibility,
    });
    setCreating(false);
    // The parent either closes the dialog or swaps the view, which unmounts the
    // form and resets its state.
    return ok;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="collection-name" className="text-xs font-medium text-white/70">
          Name
        </label>
        <input
          id="collection-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Horror or Posters I’d Hang"
          maxLength={80}
          className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-white/45 focus:border-[#FF6B6B] focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="collection-description" className="text-xs font-medium text-white/70">
          Description <span className="font-normal text-white/45">Optional</span>
        </label>
        <textarea
          id="collection-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What belongs in this collection?"
          maxLength={500}
          rows={3}
          className="w-full resize-none rounded-lg border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-white/45 focus:border-[#FF6B6B] focus:outline-none"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-white/70">Visibility</legend>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(visibilityMeta) as CollectionVisibility[]).map((key) => {
            const meta = visibilityMeta[key];
            const Icon = meta.icon;
            const active = visibility === key;

            return (
              <button
                key={key}
                type="button"
                onClick={() => setVisibility(key)}
                className="flex min-h-11 min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors"
                style={{
                  borderColor: active ? "rgba(255,107,107,0.6)" : "rgba(255,255,255,0.15)",
                  backgroundColor: active ? "rgba(255,107,107,0.12)" : "transparent",
                  color: active ? "#FF6B6B" : "rgba(255,255,255,0.65)",
                }}
              >
                <Icon size={15} />
                <span className="text-[10px] font-medium uppercase tracking-wider">
                  {meta.label}
                </span>
                <span className="truncate text-[10px] text-white/45">{meta.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={!name.trim() || creating}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#FF6B6B] px-4 text-sm font-medium text-[#121212] transition-[transform,background-color] duration-150 hoverable:hover:bg-[#FF8585] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
      >
        {creating ? <Loader2 size={15} className="animate-spin" /> : <FolderPlus size={15} />}
        {creating ? "Creating…" : submitLabel}
      </button>
    </form>
  );
}
