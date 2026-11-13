// Adapted from shadcn/ui (MIT); see THIRD_PARTY_NOTICES.md.
import type {ComponentProps} from "react";
import {cn} from "../../lib/utils";

export function NativeSelect({className, ...props}: ComponentProps<"select">) {
    return <div className="relative min-w-0" data-slot="native-select-wrapper">
        <select data-slot="native-select" className={cn(
            "h-8 w-full min-w-0 appearance-none rounded-md border border-solid border-input bg-field px-3 py-1 pr-8 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50",
            className,
        )} {...props}/>
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
             className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground">
            <path d="m4 6 4 4 4-4"/>
        </svg>
    </div>;
}
