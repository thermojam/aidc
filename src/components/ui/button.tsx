// Adapted from shadcn/ui (MIT); see THIRD_PARTY_NOTICES.md.
import type {ComponentProps} from "react";
import {cn} from "../../lib/utils";

export function Button({className, type = "button", ...props}: ComponentProps<"button">) {
    return <button type={type} data-slot="button" className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-solid border-input bg-field px-3 py-1 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
        className,
    )} {...props}/>;
}
