// Card grid for collection pages. Column count comes from the width the grid
// actually gets (intrinsic sizing), so it stays correct next to the fixed
// sidebar without viewport breakpoints. Pass extra classes through cn().
export const COLLECTION_GRID_CLASSES = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]";

// Product cards use a narrower track so a 358px phone content width holds two columns.
// /inventory keeps exactly this track below `lg` and widens from there (see
// INVENTORY_GRID_CLASSES); the constant above stays the shared phone-width track.
export const PRODUCT_GRID_CLASSES = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]";

// /inventory only. Below `lg` this is the shared product grid above, untouched, so a
// 358px phone still holds two cards. From `lg` the tracks widen to 12.5rem (200px) —
// fewer, chubbier cards instead of a row of narrow ones — and the ROW tracks are written
// inline from the hook's row count (`inventoryGridRows`), so CSS auto-fill can never
// pick a different track count than the page asked for and leave the rows uneven.
// `auto-rows` stays as the guard for an implicit row: it keeps the card's 13.5rem floor
// instead of sizing that row to its content. Card height comes from the row
// (`lg:h-full` and friends live in ProductCard).
export const INVENTORY_GRID_CLASSES = [
  "grid gap-4",
  "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]",
  "lg:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]",
  "lg:auto-rows-[13.5rem]",
].join(" ");
