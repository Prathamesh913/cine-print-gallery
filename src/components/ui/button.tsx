import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium cursor-pointer transition duration-150 ease-[var(--ease-out)] focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6B6B]/70 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "rounded-full bg-[#FF6B6B] font-semibold text-[#121212] shadow-md shadow-[#FF6B6B]/15 hover:bg-[#FF8585] active:scale-95",
        outline:
          "rounded-full border border-white/15 bg-white/5 text-white hover:border-white/25 hover:bg-white/10 active:scale-95",
        ghost: "rounded-full text-white/75 hover:bg-white/10 hover:text-white",
        destructive:
          "rounded-full border border-white/15 text-white/75 hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-200",
        link: "text-[#FF6B6B] underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-5 py-2",
        sm: "min-h-9 rounded-full px-4 text-xs",
        lg: "min-h-12 px-7",
        icon: "h-11 w-11 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
