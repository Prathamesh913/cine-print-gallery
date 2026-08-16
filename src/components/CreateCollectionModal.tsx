import { play } from "cuelume";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateCollectionForm } from "./CreateCollectionForm";
import type { CollectionVisibility, UserCollection } from "@/lib/collections";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  create: (input: {
    name: string;
    description?: string;
    visibility?: CollectionVisibility;
  }) => Promise<UserCollection | null>;
}

export function CreateCollectionModal({ open, onOpenChange, create }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[80] border-white/15 bg-[#1c1c1c] text-[#F5F5F5] sm:max-w-md">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "Poppins, sans-serif" }}>Create collection</DialogTitle>
          <DialogDescription className="text-white/65">
            Organize your pinned posters into a collection.
          </DialogDescription>
        </DialogHeader>

        <CreateCollectionForm
          onSubmit={async (input) => {
            const collection = await create(input);
            if (!collection) return false;
            play("success");
            onOpenChange(false);
            return true;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
