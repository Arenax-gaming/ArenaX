"use client";

import { ReactNode } from "react";
import { DndProvider } from "react-dnd";
import { MultiBackend } from "react-dnd-multi-backend";
import { HTML5toTouch } from "rdndmb-html5-to-touch";

/**
 * Drag-and-drop provider (issue #757).
 *
 * Previously mounted `HTML5Backend` alone. The HTML5 drag-and-drop API is not
 * implemented by mobile browsers at all — it listens for `dragstart`, which
 * touch devices never fire — so every drag interaction in the app (bracket
 * seeding, party ordering) was silently inert on phones and tablets. Nothing
 * errored; the elements simply did not move.
 *
 * `MultiBackend` with the HTML5-to-Touch transition keeps both backends live
 * and switches on the first input event. Picking one at load time from a
 * `'ontouchstart' in window` check would be simpler and wrong: hybrid devices —
 * touchscreen laptops, iPads with a trackpad — genuinely receive both, and a
 * load-time choice strands whichever input the user reaches for second.
 *
 * The transition preset delays touch dragging by 200ms so a swipe is
 * interpreted as a scroll and only a deliberate press-and-hold starts a drag.
 * Without that, any attempt to scroll past a draggable element grabs it
 * instead, which is worse than drag not working at all.
 */
export function DragAndDropProvider({ children }: { children: ReactNode }) {
    return (
        <DndProvider backend={MultiBackend} options={HTML5toTouch}>
            {children}
        </DndProvider>
    );
}
