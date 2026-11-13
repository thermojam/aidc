// Adapted from shadcn/ui Radix Dialog (MIT); see THIRD_PARTY_NOTICES.md.
import type {ComponentProps} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {cn} from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;

export function DialogContent({className, children, ...props}: ComponentProps<typeof DialogPrimitive.Content>) {
    return <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay"/>
        <DialogPrimitive.Content className={cn(
            "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-32px)] w-[min(440px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-solid border-input bg-background p-0 text-foreground outline-none",
            className,
        )} {...props}>
            {children}
        </DialogPrimitive.Content>
    </DialogPrimitive.Portal>;
}
