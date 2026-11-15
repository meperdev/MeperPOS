// Card grid for collection pages. Column count comes from the width the grid
// actually gets (intrinsic sizing), so it stays correct next to the fixed
// sidebar without viewport breakpoints. Pass extra classes through cn().
export const COLLECTION_GRID_CLASSES = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]";

// Product cards use a narrower track so a 358px phone content width holds two columns.
export const PRODUCT_GRID_CLASSES = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]";
