# Facebook Marketplace — Category Systems Reference

**Purpose:** This is the persistent record of live-FB research into Marketplace's
category-specific "More details" fields and the "Meetup preferences" checkboxes.
**Read this file before doing any live FB category research again — do not repeat
the browser walkthrough from scratch.** Update it in place as more categories get
verified; do not create a second copy.

Facebook has (at least) two category-picker UI versions that the same account can show
on different days/profiles. Both are documented separately below. Per the user
(2026-08-01): the account's profiles mostly show the **New/Current** system; the
**Legacy/Glitch** system appears "sometimes... for a few days then back again."

---

## How to do this research efficiently (read this first)

Lessons from ~19 prior attempts that all struggled with the same things:

1. **Pick a listing with a short description**, or start a brand-new draft. A long
   description textarea sits directly above/beside the Category field and More
   details toggle — scrolling near it scrolls *inside* the textarea instead of the
   page, causing repeated misclicks. Short-description listings tested clean:
   "Soybean Milk Breaker Machine", "Orbit Irrigation Programmer".
2. **Starting a brand-new listing ("Item for sale") avoids this entirely** (empty
   description) but requires uploading a photo first, which the browser automation
   currently **cannot do** — `file_upload` only accepts files explicitly shared with
   the session, not arbitrary local paths. Either have the user add one photo
   manually, or edit an existing short-description listing instead.
3. **The Category field is inconsistent between a tree-browse picker and a
   text-search combobox — and now it's understood why**: on a brand-new "Item for
   sale" draft (empty Category field), clicking it always opens the **tree-browse**
   picker with no way to type-search. On an **existing listing's edit page** (Category
   already has a value), clicking it selects the current text and you can Ctrl+A +
   type to get the **text-search combobox** instead — much faster for jumping straight
   to a specific subcategory. Prefer editing an existing short-description listing
   over a blank draft for exactly this reason.
4. **The tree groups match this extension's own `<optgroup>` labels in
   `popup.html` almost exactly** (Home & Garden, Appliances, Entertainment,
   Clothing & Accessories, Family, Electronics, Hobbies & Crafts, Sports &
   Outdoors, Automotive & Parts, Music & Media, Antiques & Collectibles) — use
   that list as the checklist of what to verify, in that order.
5. **"More details" is a real collapsed disclosure, not conditionally-rendered** —
   `find` can sometimes describe its hidden field names without expanding it, but
   this is **not reliable** (it gave a wrong guess at least once). Always click it
   and confirm with a screenshot before recording a category's fields.
6. **Never click "Update"/"Save"/"Publish"** while poking at category values for
   research — always exit via the X/Close button and choose "Leave Page" (discard)
   so the real listing is untouched.

---

## Meetup preferences (identical on every category, both systems)

Section header: **"Meetup preferences"** — "Buyers will be able to see your
preferences on your listing." Three independent checkboxes (`role="checkbox"`,
each `textContent` starts with the label below — that's how `content_main.js`'s
`setMeetupPreferences()` matches them):

| Label | Sublabel | Schema field |
|---|---|---|
| Public meetup | Meet at a public location. | `publicMeetup` |
| Door pickup | Buyer picks up at your door. | `doorPickup` |
| Door dropoff | You drop off at buyer's door. | `doorDropoff` |

No "Shipping" checkbox in this section on either system, on any category tested.
Already wired: automation in `content/content_main.js` (`setMeetupPreferences`),
UI checkboxes in `popup.html`/`popup_main.js` (`publicMeetupCheckbox` /
`doorPickupCheckbox` / `doorDropoffCheckbox` — pre-existing code, just needed the
dead `deliveryFormObserver` container-ID bug fixed, done 2026-08-01).

---

## System A — New/Current (verified on profile "Ed Goodsell", 2026-08-01)

Category field behaves as a **tree browse** (click → top-level groups list, each
expandable). Legacy full names (e.g. "Tools & Home Improvement") still display on
old untouched listings, but the **picker's current short names are what a new
selection produces** — use the short names for automation matching.

No "Product tags" field anywhere on this system (removed by FB). No "Availability"
(quantity/single-item) dropdown, no "Offer Personalization" seen either — those
belong to System B only.

**Important:** the picker's top-level convenience option (e.g. plain "Furniture")
and a real specific subcategory under it (e.g. "Living Room Furniture Sets") can
show **different** More details fields — don't assume the top-level entry
represents the whole group. Verify actual subcategories separately where possible.

| Group | Subcategory | More details fields | Status |
|---|---|---|---|
| Home & Garden | Tools | SKU | ✅ verified |
| Home & Garden | Furniture *(top-level convenience option)* | Color (dropdown), Material (?), Finish (?), SKU | ✅ verified |
| Home & Garden | → Living Room Furniture Sets | Color (dropdown), Decor Style (dropdown), Pieces Included (dropdown), SKU | ✅ verified |
| Home & Garden | → Bedroom Furniture Sets *(System B name — recheck under System A)* | — | ❌ not yet checked |
| Home & Garden | Household | Material (?), Color (dropdown), SKU | ✅ verified |
| Home & Garden | Garden | Plant Type (?), Common Plant Name (?), Light Requirement (?), SKU | ✅ verified |
| Home & Garden | → Smart Sprinklers | *(has its own subcategory — not yet expanded, seen only as the pre-set category on a real listing)* | ❌ not yet checked |
| Home & Garden | Appliances | Material (?), Color (dropdown), SKU | ✅ verified |
| Entertainment | Video Games | Product Line (?), Storage Capacity (?), Color (dropdown), SKU | ✅ verified |
| Entertainment | Books, Movies & Music | — | ❌ not yet checked |
| Clothing & Accessories | Women's clothing & shoes | Color (dropdown), Material (?), SKU | ✅ verified |
| Clothing & Accessories | Men's clothing & shoes | — | ❌ not yet checked |
| Clothing & Accessories | Bags & Luggage | — | ❌ not yet checked |
| Clothing & Accessories | Jewelry & Accessories | — | ❌ not yet checked |
| Family | Health & beauty | Color (dropdown), Material (?), SKU | ✅ verified |
| Family | Pet Supplies | — | ❌ not yet checked |
| Family | Baby & kids | — | ❌ not yet checked |
| Family | Toys & Games | — | ❌ not yet checked |
| Electronics | Electronics & computers, Mobile phones | — | ❌ not yet checked |
| Hobbies & Crafts | Hobbies, Arts & Crafts | — | ❌ not yet checked |
| Sports & Outdoors | Sports & Outdoors, Bicycles | — | ❌ not yet checked |
| Automotive & Parts | Auto parts | — | ❌ not yet checked |
| Music & Media | Musical Instruments | — | ❌ not yet checked |
| Antiques & Collectibles | Antiques & Collectibles | — | ❌ not yet checked |
| (ungrouped) | Garage Sale, Miscellaneous | — | ❌ not yet checked |

`(?)` = confirmed the field exists but its dropdown option list hasn't been
captured yet — click into it and record the options next time, same as done below
for Color/Decor Style/Pieces Included.

### Dropdown option lists captured so far (System A)

**Color** — confirmed identical across every category that has this field:
Beige, Black, Blue, Brown, Clear, Gold, Gray, Green, Multi-Color, Orange, Pink,
Purple, Red, Silver, White, Yellow.

**Decor Style** (seen on Living Room Furniture Sets):
Americana, Art Deco, Asian, Bohemian, Coastal, Contemporary, Country & Cottage,
Craftsman & Mission, Danish Modern, Eclectic, Farmhouse, French Country, Glam,
Industrial, Mediterranean, Mid-Century Modern, Minimalist, Modern, Old World,
Pastoral, Rustic, Scandinavian, Shabby Chic, Southwestern, Traditional,
Transitional, Tropical, Victorian, Vintage.

**Pieces Included** (seen on Living Room Furniture Sets — likely multi-select):
Chair, Coffee Table, Console Table, End Table, Loveseat, Ottoman, Sectional, Sofa,
TV Stand.

Still needed: Material, Finish, Plant Type, Common Plant Name, Light Requirement,
Product Line, Storage Capacity — click into each and record options the same way.

---

## System B — Legacy/Glitch (verified on profile "Eddie Price", 2026-08-01)

Category field behaves as a **flat text-search combobox** (type → filtered
suggestions, click one). Generic fields present whenever "More details" has
anything at all: **Availability** (quantity dropdown, default "List as Single
Item" — unrelated to meetup availability), **Offer Personalization** (optional
expandable "+"), **Product tags** (text, comma/enter-separated, limit 20),
**SKU** (text). Category-specific fields, when present, are inserted between
Availability and Product tags.

| Category tested (exact FB name) | Category-specific fields found | Status |
|---|---|---|
| Tools & Home Improvement | *(none — no More details section shown at all)* | ✅ verified |
| Bedroom Furniture Sets | Bed Size, Color, Bed Type | ✅ verified |
| Desktop Computers | *(none beyond generic set)* | ✅ verified |
| Women's Belts | *(none beyond generic set)* | ✅ verified |
| Everything else in the 28-category extension list | — | ❌ not yet checked |

Note: "Core"/"Comfort Level" (removed from this extension's own UI on 2026-08-01)
never appeared on Bedroom Furniture Sets — those likely belong to a "Mattresses"
category, which was never in this extension's own category dropdown, so they were
already unreachable before removal.

---

---

## What happens when an imported listing's category has no match in the extension

The extension's own category dropdown (`popup.html`, `<select id="category">`) only
has ~26 shorthand options. Real Facebook listings can use much more specific
subcategories that aren't in that list at all (e.g. "Bird Feeders" under Patio &
Garden). When importing such a listing:

- `popup_main.js`'s `setSelect()` (~line 22677) fuzzy-matches the scraped category
  text against those ~26 options by token overlap. A category with zero token
  overlap (like "Bird Feeders" vs. our list) scores 0 and matches nothing.
- **Before 2026-08-01 this left the Category field silently blank** — the
  "fall back to Miscellaneous" logic only fired when FB gave *no* category at all,
  not when it gave a real one we just don't carry.
- **Fixed 2026-08-01**: if `setSelect` finds no match, the code now falls back to
  `Miscellaneous`, shows the existing "Please manually pick the exact category when
  posting" note (`#other-category-note`), and — since nothing in our schema has
  room for an arbitrary category string — writes the original scraped category name
  into the SKU field (`"FB category: Bird Feeders"`, only if SKU was still empty)
  purely so it isn't lost and you can see what it actually was.
- This is a stopgap, not real support for that subcategory — it doesn't unlock
  any category-specific "More details" fields for it. If a specific subcategory
  comes up often enough to be worth first-class support, add it to `popup.html`'s
  `<select id="category">` and to this doc's tables above.

---

## Old→new category name mapping (`newcategory2old.json`)

`#extension/AutoList_Pro/newcategory2old.json` maps each of the 26 current category
names to the list of old-FB subcategory names that should route to it, built from
the old taxonomy saved in `Documents/FB Categories JSON.TXT` / `FB Categories
TREE.TXT`. Use this for matching a scraped/imported listing's real (possibly old)
category string to one of the extension's 26 options — same purpose as the
unmatched-category fallback described below, but proactive instead of reactive.

Known gaps/ambiguities baked into that file (documented there isn't possible since
it's pure JSON, so noted here instead):
- **Women's clothing & shoes** and **Men's clothing & shoes** currently list the
  *same* old subcategories (`Clothing`, `Shoes`) — the old taxonomy data available
  didn't split by gender at this depth. Real disambiguation needs to come from the
  listing title/description, not the category string alone.
- **Bicycles** and **Sports & Outdoors** both list `Outdoor Sports` / `Bicycles` —
  old FB nested bikes under `Sporting Goods > Outdoor Sports`, not as their own
  top-level, so the two new categories overlap here.
- **Garage Sale** and **Hobbies** have no entries — Garage Sale is a listing-type
  flag on old FB, not a real category; Hobbies has no equivalent in the saved old
  taxonomy data at all (only its sibling "Arts & Crafts" is covered). Both stay
  empty until a source for them turns up.
- Old **Office Supplies** has no direct match in the new 26 — `Office Electronics`
  was routed to `Electronics & computers`, everything else to `Miscellaneous`.

## Extension category list vs. the user's pasted "new" list (2026-08-01) — resolved

Confirmed by the user: **there is no standalone "Electronics" category** — that
entry in the pasted list was an error. "Hobbies" **is** real and matches the
extension. `popup.html` and `newcategory2old.json` are both correct as-is; no code
change needed. The old `Electronics` (top-level) subcategories — Cameras, Computers
& Tablets, Home Audio & Theater, TV & Video, Wearable Technology — all route to
**Electronics & computers** instead of a nonexistent "Electronics" bucket.

## Open questions for next session

- Which system (A or B) is live *right now* — check before trusting either table
  as current; if a category isn't listed for the active system, it's simply unverified,
  not confirmed-empty.
- Finish the ❌ rows above for whichever system is currently live, using the
  efficiency notes at the top of this file.
- Once both tables are reasonably complete, extend `content/content_main.js`'s
  `setProductTagsAndSku`-style pattern to a per-category "more details" filler
  driven by this table (currently only SKU/Product tags/meetup are wired).
