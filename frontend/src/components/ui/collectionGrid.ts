// Card grid for collection pages. Column count comes from the width the grid
// actually gets (intrinsic sizing), so it stays correct next to the fixed
// sidebar without viewport breakpoints. Pass extra classes through cn().
export const COLLECTION_GRID_CLASSES = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]";

// Product cards use a narrower track so a 358px phone content width holds two columns.
export const PRODUCT_GRID_CLASSES = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]";

// Content that replaces a skeleton fades in once, so the swap reads as arrival
// instead of a repaint. With `prefers-reduced-motion` it lands immediately.
export const COLLECTION_CONTENT_ENTER_CLASSES =
  "animate-[fade-in_200ms_ease-out_forwards] motion-reduce:animate-none";

// A refetch keeps the current rows on screen; they dim instead of resetting to a
// skeleton. Motion-safe only, it is decoration.
export const COLLECTION_PENDING_CLASSES =
  "transition-opacity duration-150 motion-reduce:transition-none";
export const COLLECTION_PENDING_OPACITY_CLASS = "opacity-60";
