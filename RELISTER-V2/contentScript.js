// Relistify V2 — In-Page Content Script
// 100% Local-first, self-contained Facebook Marketplace relister.
// No external servers, no logins, no paywalls, with humanized 1% paced execution.

(function () {
  "use strict";

  // Message Bus constants
  const MSG = {
    SCAN_LISTINGS: "rlf:scan-listings",
    REQUEST_SCAN: "rlf:request-scan",
    READ_PAGE_VAR: "rlf:page-var",
    READ_PAGE_VARS: "rlf:page-vars",
    VIDEO_DOWNLOAD_BEGIN: "rlf:video-download-begin",
    VIDEO_DOWNLOAD_CHUNK: "rlf:video-download-chunk",
    VIDEO_DOWNLOAD_END: "rlf:video-download-end",
    FETCH_SUBSCRIBER: "rlf:user",
    FETCH_PLANS: "rlf:plans",
    LAUNCH_CHECKOUT: "rlf:pay",
    LAUNCH_LOGIN: "rlf:login",
    UPDATE_BADGE: "rlf:badge"
  };

  const STORAGE_KEYS = {
    PRICE_DROP: "rlf_price_drop",
    LISTINGS_CACHE: "rlf_listings",
    RELISTED_CACHE: "rlf_relisted",
    GROUPS: "rlf_facebook_groups_v1",
    COLLAPSED: "rlf_panel_collapsed",
    TOKEN_CACHE: "FB_TOKEN_CACHE",
    DOC_ID_CACHE: "FB_DOC_ID_CACHE",
    SPEED_PACING: "rlf_speed_pacing"
  };

  // State container
  const STATE = {
    userId: null,
    fbDtsg: null,
    lsd: null,
    marketplaceId: null,
    docIds: {
      activeListings: "6206851639350477",
      mediaViewer: null,
      deleteListing: null,
      createListing: null,
      composerRoot: null
    },
    scanState: "idle", // "idle" | "scanning" | "ready" | "empty"
    activeListings: [],
    activeListingsMap: {},
    selectedIds: new Set(),
    staleDays: 7,
    isPanelCollapsed: false,
    activeTab: "relist", // "relist" | "groups"
    isRelisting: false,
    priceDrop: { mode: "off", value: 0, floor: 0 },
    pacingMultiplier: 1.01, // 1% slower humanized pacing
    groupsState: { kind: "idle", groups: [], selectedIds: new Set() }
  };

  const DEDUPE_WINDOW_MS = 900000; // 15 minutes deduplication window

  // SVG Icons
  const SVG_LOGO = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 21v-5h-5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const SVG_REFRESH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M23 4v6h-6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 20v-6h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const SVG_CHEVRON_DOWN = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const SVG_CHEVRON_UP = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M18 15l-6-6-6 6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // --------------------------------------------------------------------------
  // 1. Helper Utilities & Pacing
  // --------------------------------------------------------------------------
  const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, Math.round(ms * (STATE.pacingMultiplier || 1.01)))));

  function isSellingPage() {
    const p = (location.pathname || "").toLowerCase();
    return p.includes("/marketplace/you/selling") ||
           p.includes("/marketplace/seller/listings") ||
           p.includes("/marketplace/selling");
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, c => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function formatTimeAgo(timestampMs) {
    if (!timestampMs) return "";
    const diffSec = Math.floor((Date.now() - timestampMs) / 1000);
    const diffDays = Math.floor(diffSec / 86400);
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "1d ago";
    return `${diffDays}d ago`;
  }

  function getListingAgeDays(timestampMs) {
    if (!timestampMs) return 0;
    return Math.floor((Date.now() - timestampMs) / (86400 * 1000));
  }

  // --------------------------------------------------------------------------
  // 2. Token & Page Variable Acquisition (MAIN world Bridge)
  // --------------------------------------------------------------------------
  async function requestPageVar(key, url, options = {}, allowReaderTab = false) {
    try {
      const res = await chrome.runtime.sendMessage({
        kind: MSG.READ_PAGE_VAR,
        args: { key, url: url || location.href, options, allowReaderTab }
      });
      if (res && res.error) throw new Error(res.error);
      return res;
    } catch (e) {
      return null;
    }
  }

  async function requestPageVars(keys, url, options = {}, allowReaderTab = false) {
    try {
      const res = await chrome.runtime.sendMessage({
        kind: MSG.READ_PAGE_VARS,
        args: { keys, url: url || location.href, options, allowReaderTab }
      });
      if (res && res.error) throw new Error(res.error);
      return res || {};
    } catch (e) {
      return {};
    }
  }

  async function ensureTokens(allowReaderTab = false) {
    if (STATE.fbDtsg && STATE.userId) return true;

    try {
      const cached = (await chrome.storage.local.get(STORAGE_KEYS.TOKEN_CACHE))[STORAGE_KEYS.TOKEN_CACHE];
      if (cached && cached.expiry > Date.now() && cached.tokens?.fbDtsg && cached.tokens?.userId) {
        STATE.fbDtsg = cached.tokens.fbDtsg;
        STATE.userId = cached.tokens.userId;
        STATE.lsd = cached.tokens.lsd || null;
        STATE.marketplaceId = cached.tokens.marketplaceId || null;
      }
    } catch (e) {}

    if (!STATE.fbDtsg || !STATE.userId) {
      const targetUrl = "https://www.facebook.com/marketplace/you/selling/";
      const vars = await requestPageVars(["DTSGInitialData", "CurrentUserInitialData", "LSD"], targetUrl, {}, allowReaderTab);
      if (vars.DTSGInitialData?.token) {
        STATE.fbDtsg = vars.DTSGInitialData.token;
      }
      if (vars.CurrentUserInitialData?.USER_ID || vars.CurrentUserInitialData?.ACCOUNT_ID) {
        STATE.userId = vars.CurrentUserInitialData.USER_ID || vars.CurrentUserInitialData.ACCOUNT_ID;
      }
      if (vars.LSD?.token) {
        STATE.lsd = vars.LSD.token;
      }

      if (!STATE.marketplaceId) {
        try {
          const jsonVars = await requestPageVar("marketplace_product_details_page", targetUrl, {
            inline_json: true,
            wait_ms: 3000
          }, allowReaderTab);
          if (jsonVars?.target?.marketplace_id) {
            STATE.marketplaceId = jsonVars.target.marketplace_id;
          }
        } catch (e) {}
      }

      if (!STATE.userId) {
        const match = document.cookie.match(/c_user=(\d+)/);
        if (match) STATE.userId = match[1];
      }

      if (STATE.fbDtsg && STATE.userId) {
        chrome.storage.local.set({
          [STORAGE_KEYS.TOKEN_CACHE]: {
            tokens: {
              fbDtsg: STATE.fbDtsg,
              userId: STATE.userId,
              lsd: STATE.lsd,
              marketplaceId: STATE.marketplaceId
            },
            expiry: Date.now() + 3600000
          }
        }).catch(() => {});
      }
    }

    await ensureDocIds(allowReaderTab);
    return Boolean(STATE.fbDtsg && STATE.userId);
  }

  async function ensureDocIds(allowReaderTab = false) {
    try {
      const cached = (await chrome.storage.local.get(STORAGE_KEYS.DOC_ID_CACHE))[STORAGE_KEYS.DOC_ID_CACHE];
      if (cached && cached.expiry > Date.now() && cached.docIds) {
        STATE.docIds = Object.assign(STATE.docIds, cached.docIds);
      }
    } catch (e) {}

    const neededOperations = [];
    if (!STATE.docIds.deleteListing) neededOperations.push("useCometMarketplaceForSaleItemDeleteMutation_facebookRelayOperation");
    if (!STATE.docIds.createListing) neededOperations.push("useCometMarketplaceListingCreateMutation_facebookRelayOperation");
    if (!STATE.docIds.mediaViewer) neededOperations.push("MarketplacePDPC2CMediaViewerWithImagesQuery_facebookRelayOperation");
    if (!STATE.docIds.composerRoot) neededOperations.push("CometMarketplaceComposerRootComponentQuery_facebookRelayOperation");

    if (neededOperations.length > 0) {
      const targetUrl = "https://www.facebook.com/marketplace/you/selling/";
      const harvested = await requestPageVars(neededOperations, targetUrl, {}, allowReaderTab);
      if (harvested.useCometMarketplaceForSaleItemDeleteMutation_facebookRelayOperation) {
        STATE.docIds.deleteListing = harvested.useCometMarketplaceForSaleItemDeleteMutation_facebookRelayOperation;
      }
      if (harvested.useCometMarketplaceListingCreateMutation_facebookRelayOperation) {
        STATE.docIds.createListing = harvested.useCometMarketplaceListingCreateMutation_facebookRelayOperation;
      }
      if (harvested.MarketplacePDPC2CMediaViewerWithImagesQuery_facebookRelayOperation) {
        STATE.docIds.mediaViewer = harvested.MarketplacePDPC2CMediaViewerWithImagesQuery_facebookRelayOperation;
      }
      if (harvested.CometMarketplaceComposerRootComponentQuery_facebookRelayOperation) {
        STATE.docIds.composerRoot = harvested.CometMarketplaceComposerRootComponentQuery_facebookRelayOperation;
      }

      chrome.storage.local.set({
        [STORAGE_KEYS.DOC_ID_CACHE]: {
          docIds: STATE.docIds,
          expiry: Date.now() + 86400000
        }
      }).catch(() => {});
    }
  }

  // --------------------------------------------------------------------------
  // 3. Facebook GraphQL Client
  // --------------------------------------------------------------------------
  async function callGraphQL(friendlyName, docId, variables, targetUrl = "https://www.facebook.com/api/graphql/") {
    if (!STATE.fbDtsg || !STATE.userId) {
      await ensureTokens();
    }

    const params = new URLSearchParams();
    params.append("av", STATE.userId || "");
    params.append("__a", "1");
    params.append("__comet_req", "1");
    params.append("fb_dtsg", STATE.fbDtsg || "");
    params.append("fb_api_caller_class", "RelayModern");
    params.append("fb_api_req_friendly_name", friendlyName);
    params.append("variables", JSON.stringify(variables || {}));
    if (docId) {
      params.append("doc_id", String(docId));
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "*/*"
      },
      credentials: "include",
      body: params.toString()
    });

    if (!res.ok) {
      throw new Error(`GraphQL network error: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data?.errors?.length) {
      const msg = data.errors[0]?.message || "Facebook GraphQL error";
      throw new Error(msg);
    }
    return data;
  }

  // --------------------------------------------------------------------------
  // 4. Listing Scan & Parsing
  // --------------------------------------------------------------------------
  async function getRecentlyRelistedIds() {
    try {
      const stored = (await chrome.storage.local.get(STORAGE_KEYS.RELISTED_CACHE))[STORAGE_KEYS.RELISTED_CACHE] || {};
      const now = Date.now();
      const ids = new Set();
      for (const [id, time] of Object.entries(stored)) {
        if (now - time <= DEDUPE_WINDOW_MS) {
          ids.add(id);
        }
      }
      return ids;
    } catch (e) {
      return new Set();
    }
  }

  async function markListingRelisted(listingId) {
    if (!listingId) return;
    try {
      const stored = (await chrome.storage.local.get(STORAGE_KEYS.RELISTED_CACHE))[STORAGE_KEYS.RELISTED_CACHE] || {};
      stored[listingId] = Date.now();
      await chrome.storage.local.set({ [STORAGE_KEYS.RELISTED_CACHE]: stored });
    } catch (e) {}
  }

  function parseListingEdgeNode(node) {
    if (!node || !node.id) return null;
    const item = node.for_sale_item || node;
    const title = item.marketplace_listing_title || item.title || "";
    const priceAmount = item.listing_price?.formatted_amount || item.formatted_price || "";
    const rawPrice = item.listing_price?.amount || "0";
    const numericPrice = parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0;
    const creationTimeSec = item.creation_time || item.created_time || (Date.now() / 1000);
    const creationTimeMs = creationTimeSec * 1000;
    const photoUrl = item.primary_listing_photo?.image?.uri || item.listing_photos?.[0]?.image?.uri || "";

    return {
      id: String(item.id || node.id),
      title: String(title).trim(),
      formattedPrice: priceAmount,
      numericPrice,
      creationTimeMs,
      ageDays: getListingAgeDays(creationTimeMs),
      photoUrl,
      raw: item
    };
  }

  // Tokens are only needed for the GraphQL top-up and for relisting itself.
  // Never let them gate the first paint: the page's own JSON blobs already
  // carry titles, prices and creation_time.
  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => resolve(fallback), ms))
    ]);
  }

  async function scanActiveListings() {
    STATE.scanState = "scanning";
    renderPanel();
    const recentlyRelisted = await getRecentlyRelistedIds();
    const listings = [];
    const seenIds = new Set();

    // 1. Scan from DOM JSON script blobs first for immediate rendering
    const scriptNodes = Array.from(document.querySelectorAll('script[type="application/json"]'));
    for (const s of scriptNodes) {
      try {
        const json = JSON.parse(s.textContent || "{}");
        const walk = obj => {
          if (!obj || typeof obj !== "object") return;
          if (Array.isArray(obj.edges)) {
            for (const edge of obj.edges) {
              if (edge?.node?.id && (edge.node.for_sale_item || edge.node.marketplace_listing_title)) {
                const parsed = parseListingEdgeNode(edge.node);
                if (parsed && !seenIds.has(parsed.id) && !recentlyRelisted.has(parsed.id)) {
                  seenIds.add(parsed.id);
                  listings.push(parsed);
                }
              }
            }
          }
          for (const v of Object.values(obj)) walk(v);
        };
        walk(json);
      } catch (e) {}
    }

    const domFound = listings.length;
    console.log("[Relistify] scan: DOM pass found", domFound, "listings from",
      document.querySelectorAll('script[type="application/json"]').length, "json blobs");

    // First paint from DOM data alone — the box is on screen from here on.
    STATE.activeListings = listings;
    STATE.activeListingsMap = Object.fromEntries(listings.map(l => [l.id, l]));
    if (listings.length > 0) {
      STATE.scanState = "ready";
      renderPanel();
      decorateListingCardsInDOM();
    }

    // 2. Query GraphQL Pagination if available to get complete catalog
    await withTimeout(ensureTokens(), 8000, false);
    if (STATE.docIds.activeListings) {
      try {
        const queryVars = { count: 40 };
        const res = await callGraphQL("MarketplaceYouSellingFastActiveSectionPaginationQuery", STATE.docIds.activeListings, queryVars);
        const edges = res?.data?.viewer?.marketplace_you_selling_fast_active_section?.edges || [];
        for (const edge of edges) {
          const parsed = parseListingEdgeNode(edge.node);
          if (parsed && !seenIds.has(parsed.id) && !recentlyRelisted.has(parsed.id)) {
            seenIds.add(parsed.id);
            listings.push(parsed);
          }
        }
      } catch (e) {}
    }

    STATE.activeListings = listings;
    STATE.activeListingsMap = Object.fromEntries(listings.map(l => [l.id, l]));
    STATE.scanState = listings.length > 0 ? "ready" : "empty";
    console.log("[Relistify] scan complete:", {
      domFound,
      afterGraphQL: listings.length,
      haveDtsg: Boolean(STATE.fbDtsg),
      haveUserId: Boolean(STATE.userId),
      staleDays: STATE.staleDays,
      staleCount: getStaleListings().length,
      ages: listings.map(l => l.ageDays)
    });

    // Cache listings
    chrome.storage.local.set({
      [STORAGE_KEYS.LISTINGS_CACHE]: {
        listings,
        timestamp: Date.now()
      }
    }).catch(() => {});

    // Update badge & UI
    updateBadgeCount();
    renderPanel();
    decorateListingCardsInDOM();
    return listings;
  }

  function getStaleListings() {
    return STATE.activeListings.filter(l => l.ageDays >= STATE.staleDays);
  }

  function updateBadgeCount() {
    const staleCount = getStaleListings().length;
    chrome.runtime.sendMessage({
      kind: MSG.UPDATE_BADGE,
      args: { staleCount }
    }).catch(() => {});
  }

  // --------------------------------------------------------------------------
  // 5. Media Retrieval & Photo Re-Upload
  // --------------------------------------------------------------------------
  async function fetchListingPhotos(listingId) {
    try {
      if (STATE.docIds.mediaViewer) {
        const res = await callGraphQL("MediaViewerResponse", STATE.docIds.mediaViewer, { targetId: listingId });
        const edges = res?.data?.node?.media_viewer_response?.edges || [];
        const uris = edges.map(e => e.node?.image?.uri).filter(Boolean);
        if (uris.length > 0) return uris;
      }
    } catch (e) {}

    const cached = STATE.activeListingsMap[listingId];
    if (cached?.photoUrl) return [cached.photoUrl];
    return [];
  }

  async function uploadPhotoToFacebook(imageUri) {
    const blob = await (await fetch(imageUri)).blob();
    const formData = new FormData();
    formData.append("fb_dtsg", STATE.fbDtsg);
    formData.append("target_id", STATE.marketplaceId || STATE.userId);
    formData.append("source", "8");
    formData.append("profile_id", STATE.userId);
    formData.append("farr", blob, "blob");

    const uploadUrl = `https://upload.facebook.com/ajax/react_composer/attachments/photo/upload?av=${STATE.userId}&__user=${STATE.userId}&__a=1&fb_dtsg=${STATE.fbDtsg}`;
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Accept": "*/*" },
      referrer: "https://www.facebook.com/",
      referrerPolicy: "strict-origin-when-cross-origin",
      body: formData,
      mode: "cors",
      credentials: "include"
    });

    const text = await res.text();
    const jsonStr = text.startsWith("for (;;);") ? text.substring(9) : text;
    const json = JSON.parse(jsonStr);
    const photoId = json?.payload?.photoID;
    if (!photoId) throw new Error("Photo upload succeeded but no photoID was returned.");
    return photoId;
  }

  // --------------------------------------------------------------------------
  // 6. Delete & Recreate Mutations (The Core Relist Flow)
  // --------------------------------------------------------------------------
  async function fetchItemDetailsForRelist(listingId) {
    const itemUrl = `https://www.facebook.com/marketplace/item/${listingId}/`;
    let details = null;

    try {
      const pageVars = await requestPageVar("marketplace_product_details_page", itemUrl, {
        inline_json: true,
        wait_ms: 4000
      });
      if (pageVars?.target) {
        details = pageVars.target;
      }
    } catch (e) {}

    let composerData = null;
    if (STATE.docIds.composerRoot) {
      try {
        const compRes = await callGraphQL("CometMarketplaceComposerRootComponentQuery", STATE.docIds.composerRoot, {
          listingId,
          is_edit: true,
          composer_mode: "EDIT_LISTING",
          scale: 1,
          prefill_id: "0",
          category_id: "0",
          has_prefill_data: false,
          has_prefetched_category: false,
          delivery_types: ["in_person"]
        });
        composerData = compRes?.data?.listing || null;
      } catch (e) {}
    }

    const cachedItem = STATE.activeListingsMap[listingId] || {};
    const title = details?.marketplace_listing_title || composerData?.marketplace_listing_title || cachedItem.title || "Item For Sale";
    const description = details?.redacted_description?.text || details?.description || composerData?.redacted_description?.text || "Available for pickup.";
    const categoryId = details?.marketplace_listing_category_id || composerData?.marketplace_listing_virtual_taxonomy_category?.id || "1";

    let rawPrice = details?.listing_price?.amount || String(cachedItem.numericPrice || "0");
    let currentPriceNum = parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || cachedItem.numericPrice || 0;

    // Calculate Price Drop
    let finalPrice = Math.round(currentPriceNum);
    if (STATE.priceDrop.mode === "percent" && STATE.priceDrop.value > 0) {
      finalPrice = Math.round(currentPriceNum * (1 - STATE.priceDrop.value / 100));
    } else if (STATE.priceDrop.mode === "amount" && STATE.priceDrop.value > 0) {
      finalPrice = Math.round(currentPriceNum - STATE.priceDrop.value);
    }
    const floor = Math.max(1, Math.floor(STATE.priceDrop.floor) || 1);
    finalPrice = Math.max(floor, finalPrice);

    const lat = details?.location?.latitude || composerData?.location?.latitude || 0;
    const lng = details?.location?.longitude || composerData?.location?.longitude || 0;

    return {
      title,
      description,
      categoryId: String(categoryId),
      price: String(finalPrice),
      latitude: lat,
      longitude: lng,
      details,
      composerData
    };
  }

  async function deleteListing(listingId) {
    const deleteMutationDocId = STATE.docIds.deleteListing || "useCometMarketplaceForSaleItemDeleteMutation";
    const deleteVars = {
      input: {
        client_mutation_id: "-1",
        actor_id: STATE.userId,
        batch_delete_variants: true,
        for_sale_item_id: listingId,
        referral_surface: "MARKETPLACE_INSIGHTS",
        surface: "MARKETPLACE_PAGE_SELLING"
      }
    };
    return await callGraphQL("useCometMarketplaceForSaleItemDeleteMutation", deleteMutationDocId, deleteVars);
  }

  async function createReplacementListing(payload, photoIds) {
    const createMutationDocId = STATE.docIds.createListing || "useCometMarketplaceListingCreateMutation";
    const createVars = {
      input: {
        client_mutation_id: "-1",
        actor_id: STATE.userId,
        audience: {
          marketplace: {
            marketplace_id: STATE.marketplaceId || STATE.userId
          }
        },
        data: {
          common: {
            title: payload.title,
            description: payload.description,
            category_id: payload.categoryId,
            price: payload.price,
            latitude: payload.latitude,
            longitude: payload.longitude,
            photo_ids: photoIds,
            video_ids: [],
            surface: "composer",
            is_preview: false,
            is_personalization_required: null,
            personalization_info: null,
            draft_type: null,
            quantity: null,
            cost_per_additional_item: null,
            comparable_price: "null",
            min_acceptable_checkout_offer_price: "null",
            suggested_hashtag_names: [],
            variants: [],
            xpost_target_ids: Array.from(STATE.groupsState.selectedIds || [])
          }
        }
      }
    };
    const res = await callGraphQL("useCometMarketplaceListingCreateMutation", createMutationDocId, createVars);
    const newId = res?.data?.marketplace_listing_create?.listing?.id;
    if (!newId) throw new Error("Listing created but no replacement listing ID returned.");
    return newId;
  }

  async function relistSingleListing(listingId) {
    updateOverlayText(`Fetching details for item ${listingId}...`);
    const details = await fetchItemDetailsForRelist(listingId);
    await sleep(400);

    updateOverlayText(`Prefetching photos for item ${listingId}...`);
    const photoUris = await fetchListingPhotos(listingId);
    await sleep(400);

    // Re-upload photos
    updateOverlayText(`Re-uploading ${photoUris.length} photos...`);
    const newPhotoIds = [];
    for (const uri of photoUris) {
      try {
        const pId = await uploadPhotoToFacebook(uri);
        if (pId) newPhotoIds.push(pId);
        await sleep(350);
      } catch (e) {}
    }

    // Delete old listing
    updateOverlayText(`Deleting old listing ${listingId}...`);
    await deleteListing(listingId);
    await markListingRelisted(listingId);

    // Polite human-like delay (1% paced)
    updateOverlayText(`Preparing fresh listing...`);
    await sleep(2600 + Math.random() * 1500);

    // Create replacement listing
    updateOverlayText(`Publishing refreshed listing...`);
    const replacementId = await createReplacementListing(details, newPhotoIds);

    return replacementId;
  }

  async function runBatchRelist(listingIds) {
    if (!listingIds || listingIds.length === 0) return;
    if (STATE.isRelisting) return;

    STATE.isRelisting = true;
    // The one place reader tabs are permitted. runBatchRelist is serial, so
    // this is at most one listing's worth of tabs at a time.
    await ensureTokens(true);
    showOverlay(true);

    let successCount = 0;
    let failCount = 0;
    const total = listingIds.length;

    for (let i = 0; i < total; i++) {
      const id = listingIds[i];
      updateOverlayText(`Relisting item ${i + 1} of ${total}...`);

      try {
        await relistSingleListing(id);
        successCount++;
        STATE.selectedIds.delete(id);
      } catch (err) {
        failCount++;
      }

      if (i < total - 1) {
        await sleep(2100 + Math.random() * 2000);
      }
    }

    showOverlay(false);
    STATE.isRelisting = false;

    // Toast summary
    if (successCount > 0 && failCount === 0) {
      showToast(`Successfully relisted ${successCount} listing${successCount > 1 ? "s" : ""}!`, "success");
    } else if (successCount > 0 && failCount > 0) {
      showToast(`Relisted ${successCount} items (${failCount} failed).`, "info");
    } else {
      showToast(`Failed to relist selected items. Please reload Facebook and try again.`, "error");
    }

    // Re-scan
    await scanActiveListings();
  }

  // --------------------------------------------------------------------------
  // 7. In-Page UI (Floating Panel, Badges, Modals, Toasts)
  // --------------------------------------------------------------------------
  function ensureOverlayCss() {
    if (document.getElementById("rlf-overlay-css")) return;
    const link = document.createElement("link");
    link.id = "rlf-overlay-css";
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = chrome.runtime.getURL("assets/overlay.css");
    (document.head || document.documentElement).appendChild(link);
  }

  function showOverlay(visible) {
    let el = document.getElementById("rlf-overlay");
    if (!el && visible) {
      el = document.createElement("div");
      el.id = "rlf-overlay";
      el.innerHTML = `
        <div class="rlf-overlay-card">
          <div class="rlf-spinner"></div>
          <p class="rlf-overlay-text" id="rlf-overlay-status">Relistify is working&hellip;</p>
        </div>
      `;
      document.body.appendChild(el);
    }
    if (el) {
      el.style.display = visible ? "flex" : "none";
    }
  }

  function updateOverlayText(text) {
    const el = document.getElementById("rlf-overlay-status");
    if (el) el.textContent = text;
  }

  function showToast(message, type = "success") {
    let toast = document.getElementById("rlf-toast-card");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "rlf-toast-card";
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        padding: 14px 20px;
        border-radius: 12px;
        color: #fff;
        font-family: var(--rlf-font);
        font-size: 14px;
        font-weight: 600;
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        display: flex;
        align-items: center;
        gap: 10px;
        transition: opacity 0.3s ease, transform 0.3s ease;
      `;
      document.body.appendChild(toast);
    }

    const bgColors = {
      success: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
      error: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
      info: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
    };
    toast.style.background = bgColors[type] || bgColors.info;
    toast.textContent = message;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    setTimeout(() => {
      if (toast) {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
      }
    }, 4500);
  }

  function openPriceDropModal() {
    let overlay = document.getElementById("rlf-price-modal-overlay");
    if (overlay) overlay.remove();

    overlay = document.createElement("div");
    overlay.id = "rlf-price-modal-overlay";
    overlay.className = "dialog-overlay";
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
    `;

    const mode = STATE.priceDrop.mode || "off";
    const val = STATE.priceDrop.value || 5;
    const floor = STATE.priceDrop.floor || 5;

    overlay.innerHTML = `
      <div class="dialog rlf-settings" style="background:#fff; border-radius:16px; width:340px; max-width:90vw; padding:22px; box-shadow:0 20px 40px rgba(0,0,0,0.25); font-family:var(--rlf-font);">
        <h3 class="dialog-title" style="margin:0 0 6px; font-size:18px; font-weight:700; color:#1e293b;">Price Drop Settings</h3>
        <p class="dialog-subtitle" style="margin:0 0 16px; font-size:13px; color:#64748b;">Automatically lower listing price on relist.</p>

        <div class="rlf-field" style="margin-bottom:12px;">
          <label class="rlf-radio" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer; font-size:14px;">
            <input type="radio" name="rlf_p_mode" value="off" ${mode === "off" ? "checked" : ""}> No Price Drop (Keep same price)
          </label>
          <label class="rlf-radio" style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer; font-size:14px;">
            <input type="radio" name="rlf_p_mode" value="percent" ${mode === "percent" ? "checked" : ""}> Percentage Drop (%)
          </label>
          <label class="rlf-radio" style="display:flex; align-items:center; gap:8px; margin-bottom:12px; cursor:pointer; font-size:14px;">
            <input type="radio" name="rlf_p_mode" value="amount" ${mode === "amount" ? "checked" : ""}> Dollar Amount Drop ($)
          </label>
        </div>

        <div style="display:flex; gap:12px; margin-bottom:16px;">
          <div style="flex:1;">
            <label style="display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px;">Drop Value</label>
            <input id="rlf-modal-val" type="number" min="1" max="95" value="${val}" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;">
          </div>
          <div style="flex:1;">
            <label style="display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px;">Min Floor ($)</label>
            <input id="rlf-modal-floor" type="number" min="1" value="${floor}" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;">
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button id="rlf-modal-cancel" style="padding:9px 16px; border:1px solid #cbd5e1; background:#fff; border-radius:8px; font-weight:600; cursor:pointer;">Cancel</button>
          <button id="rlf-modal-save" style="padding:9px 18px; border:none; background:var(--rlf-grad-btn); color:#fff; border-radius:8px; font-weight:700; cursor:pointer;">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector("#rlf-modal-cancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#rlf-modal-save").addEventListener("click", async () => {
      const selectedMode = overlay.querySelector('input[name="rlf_p_mode"]:checked')?.value || "off";
      const dropVal = parseFloat(overlay.querySelector("#rlf-modal-val")?.value) || 0;
      const floorVal = parseFloat(overlay.querySelector("#rlf-modal-floor")?.value) || 1;

      STATE.priceDrop = { mode: selectedMode, value: dropVal, floor: floorVal };
      await chrome.storage.sync.set({ [STORAGE_KEYS.PRICE_DROP]: STATE.priceDrop });
      overlay.remove();
      renderPanel();
      showToast("Price drop settings saved!", "success");
    });
  }

  function renderPanel() {
    if (!isSellingPage()) return;
    ensureOverlayCss();

    let container = document.getElementById("rlf-select-btn");
    if (!container) {
      container = document.createElement("div");
      container.id = "rlf-select-btn";
      document.body.appendChild(container);
    }

    let relistBtn = document.getElementById("rlf-relist-btn");
    if (!relistBtn) {
      relistBtn = document.createElement("button");
      relistBtn.id = "rlf-relist-btn";
      document.body.appendChild(relistBtn);
      relistBtn.addEventListener("click", () => {
        const ids = Array.from(STATE.selectedIds);
        if (ids.length > 0) {
          runBatchRelist(ids);
        }
      });
    }

    // Update Relist Button state
    const selectedCount = STATE.selectedIds.size;
    relistBtn.textContent = STATE.isRelisting
      ? "Working\u2026"
      : selectedCount > 0
      ? `\u25b6 Start \u2014 Relist ${selectedCount} Item${selectedCount > 1 ? "s" : ""}`
      : "Select listings to start";
    relistBtn.disabled = selectedCount === 0 || STATE.isRelisting;
    relistBtn.style.display = STATE.isPanelCollapsed ? "none" : "block";

    // Collapsed Pill View
    if (STATE.isPanelCollapsed) {
      container.className = "rlf-is-pro rlf-collapsed";
      container.innerHTML = `
        <button class="rlf-brand" id="rlf-expand-btn">
          <span class="rlf-brand-mark">${SVG_LOGO}</span>
          <span>Relistify V2</span>
          <span class="rlf-expand-badge">${SVG_CHEVRON_UP}</span>
        </button>
      `;
      container.querySelector("#rlf-expand-btn").addEventListener("click", () => {
        STATE.isPanelCollapsed = false;
        chrome.storage.local.set({ [STORAGE_KEYS.COLLAPSED]: false });
        renderPanel();
      });
      return;
    }

    // Expanded Panel View
    container.className = "rlf-is-pro rlf-panel";

    const staleListings = getStaleListings();
    const staleCount = staleListings.length;
    const totalCount = STATE.activeListings.length;
    const priceDropDesc = STATE.priceDrop.mode === "percent"
      ? `-${STATE.priceDrop.value}% (min $${STATE.priceDrop.floor})`
      : STATE.priceDrop.mode === "amount"
      ? `-$${STATE.priceDrop.value} (min $${STATE.priceDrop.floor})`
      : "Off";

    const scanLine =
      STATE.scanState === "scanning" ? `<div class="rlf-scan-status is-busy">Scanning your listings\u2026</div>` :
      STATE.scanState === "empty"    ? `<div class="rlf-scan-status is-empty">${
          STATE.fbDtsg && STATE.userId
            ? "No active listings found. Try \u21bb Refresh."
            : "Couldn\u2019t read Facebook session tokens \u2014 reload this page while logged in."
        }</div>` : "";

    const listRows = STATE.activeListings.map(l => {
      const sel = STATE.selectedIds.has(l.id);
      const stale = l.ageDays >= STATE.staleDays;
      return `
        <label class="rlf-listing-row${sel ? " is-sel" : ""}" data-id="${escapeHtml(l.id)}">
          <input type="checkbox" class="rlf-listing-cb" data-id="${escapeHtml(l.id)}"${sel ? " checked" : ""}>
          <span class="rlf-listing-main">
            <span class="rlf-listing-title">${escapeHtml(l.title || "Untitled listing")}</span>
            <span class="rlf-listing-meta">
              <span>${escapeHtml(l.formattedPrice || "")}</span>
              <span class="rlf-listing-age${stale ? " is-stale" : ""}">listed ${escapeHtml(formatTimeAgo(l.creationTimeMs) || "\u2014")}</span>
            </span>
          </span>
        </label>`;
    }).join("");

    container.innerHTML = `
      <div class="rlf-panel-head">
        <span class="rlf-brand-mark">${SVG_LOGO}</span>
        <span class="rlf-brand-name">Relistify V2</span>
        <span class="rlf-head-actions">
          <button class="rlf-icon-btn" id="rlf-refresh-btn" title="Refresh Listings">${SVG_REFRESH}</button>
          <button class="rlf-icon-btn" id="rlf-minimize-btn" title="Minimize">${SVG_CHEVRON_DOWN}</button>
        </span>
      </div>

      <div class="rlf-tabs">
        <button class="rlf-tab ${STATE.activeTab === "relist" ? "is-active" : ""}" id="rlf-tab-relist">Relist</button>
        <button class="rlf-tab ${STATE.activeTab === "groups" ? "is-active" : ""}" id="rlf-tab-groups">Groups <span class="rlf-pro">ACTIVE</span></button>
      </div>

      <div class="rlf-panel-body" id="rlf-panel-relist-content" style="${STATE.activeTab === "relist" ? "" : "display:none;"}">
        <div class="rlf-section">
          <div class="rlf-section-title">Freshness Filter</div>
          <div class="rlf-pick-row">
            <span class="rlf-pick-label">Older than:</span>
            <button class="rlf-step" id="rlf-stale-dec">&minus;</button>
            <span class="rlf-pick-n rlf-pick-days" id="rlf-stale-days-num">${STATE.staleDays}d</span>
            <button class="rlf-step" id="rlf-stale-inc">&plus;</button>
          </div>
          <button class="rlf-chip" id="rlf-select-stale-btn">Select Stale (${staleCount})</button>
        </div>

        <div class="rlf-section">
          <div class="rlf-section-title">Listings to Delete &amp; Relist</div>
          ${scanLine}
          <div class="rlf-listing-list" id="rlf-listing-list">${listRows}</div>
        </div>

        <div class="rlf-section">
          <div class="rlf-section-title">Price Drop Automation</div>
          <button class="rlf-setting-btn" id="rlf-price-btn">
            <span>Price Drop: <strong>${priceDropDesc}</strong></span>
            <span class="rlf-caret-right">&rsaquo;</span>
          </button>
        </div>

        <div class="rlf-selbar" id="rlf-selbar" style="${selectedCount > 0 ? "display:flex;" : "display:none;"}">
          <span><strong>${selectedCount}</strong> selected</span>
          <button class="rlf-clear" id="rlf-clear-btn">Clear</button>
        </div>

        <div style="display:flex; justify-content:space-between; font-size:12px; color:#64748b; padding-top:4px;">
          <span>Active Listings: <strong>${totalCount}</strong></span>
          <button id="rlf-select-all-btn" style="background:none; border:none; color:#2563eb; font-weight:700; cursor:pointer; padding:0;">Select All (${totalCount})</button>
        </div>
      </div>

      <div class="rlf-panel-body" id="rlf-panel-groups-content" style="${STATE.activeTab === "groups" ? "" : "display:none;"}">
        <div class="rlf-groups-card">
          <div class="rlf-groups-card-icon">&bull;&bull;&bull;</div>
          <div class="rlf-groups-card-title">Facebook Groups Auto-Crosspost</div>
          <div class="rlf-groups-card-copy">Relisted items will automatically publish to your active Marketplace groups.</div>
          <div class="rlf-groups-saved" style="margin-top:8px;">✓ All Selected Groups Active</div>
        </div>
      </div>
    `;

    // Restore the checklist scroll offset clobbered by the innerHTML rewrite.
    const listEl = container.querySelector("#rlf-listing-list");
    if (listEl && typeof STATE._listScrollTop === "number") {
      listEl.scrollTop = STATE._listScrollTop;
    }
    listEl?.addEventListener("scroll", () => {
      STATE._listScrollTop = listEl.scrollTop;
    });

    listEl?.addEventListener("change", e => {
      const cb = e.target.closest(".rlf-listing-cb");
      if (!cb) return;
      const id = cb.getAttribute("data-id");
      if (!id) return;
      if (cb.checked) STATE.selectedIds.add(id);
      else STATE.selectedIds.delete(id);
      renderPanel();
      decorateListingCardsInDOM();
    });

    // Event Handlers
    container.querySelector("#rlf-minimize-btn")?.addEventListener("click", () => {
      STATE.isPanelCollapsed = true;
      chrome.storage.local.set({ [STORAGE_KEYS.COLLAPSED]: true });
      renderPanel();
    });

    container.querySelector("#rlf-refresh-btn")?.addEventListener("click", async () => {
      const btn = container.querySelector("#rlf-refresh-btn");
      if (btn) btn.classList.add("rlf-spin");
      await scanActiveListings();
      if (btn) btn.classList.remove("rlf-spin");
      showToast("Listings refreshed!", "info");
    });

    container.querySelector("#rlf-tab-relist")?.addEventListener("click", () => {
      STATE.activeTab = "relist";
      renderPanel();
    });

    container.querySelector("#rlf-tab-groups")?.addEventListener("click", () => {
      STATE.activeTab = "groups";
      renderPanel();
    });

    container.querySelector("#rlf-stale-dec")?.addEventListener("click", () => {
      if (STATE.staleDays > 1) {
        STATE.staleDays--;
        renderPanel();
        decorateListingCardsInDOM();
      }
    });

    container.querySelector("#rlf-stale-inc")?.addEventListener("click", () => {
      if (STATE.staleDays < 90) {
        STATE.staleDays++;
        renderPanel();
        decorateListingCardsInDOM();
      }
    });

    container.querySelector("#rlf-select-stale-btn")?.addEventListener("click", () => {
      const stale = getStaleListings();
      for (const item of stale) {
        STATE.selectedIds.add(item.id);
      }
      renderPanel();
      decorateListingCardsInDOM();
    });

    container.querySelector("#rlf-select-all-btn")?.addEventListener("click", () => {
      for (const item of STATE.activeListings) {
        STATE.selectedIds.add(item.id);
      }
      renderPanel();
      decorateListingCardsInDOM();
    });

    container.querySelector("#rlf-clear-btn")?.addEventListener("click", () => {
      STATE.selectedIds.clear();
      renderPanel();
      decorateListingCardsInDOM();
    });

    container.querySelector("#rlf-price-btn")?.addEventListener("click", () => {
      openPriceDropModal();
    });
  }

  function decorateListingCardsInDOM() {
    if (!isSellingPage()) return;

    const listingAnchors = Array.from(document.querySelectorAll('a[href*="/marketplace/item/"]'));
    for (const a of listingAnchors) {
      const href = a.getAttribute("href") || "";
      const match = href.match(/\/marketplace\/item\/(\d+)/);
      if (!match) continue;

      const id = match[1];
      const card = a.closest('div[role="article"]') || a.closest('div[class*="x1lliihq"]') || a.parentElement;
      if (!card) continue;

      if (window.getComputedStyle(card).position === "static") {
        card.style.position = "relative";
      }

      // Checkbox / Pick button
      let pickBtn = card.querySelector(`.rlf-pick-btn[data-id="${id}"]`);
      if (!pickBtn) {
        pickBtn = document.createElement("button");
        pickBtn.className = "rlf-pick-btn";
        pickBtn.setAttribute("data-id", id);
        pickBtn.title = "Select to relist";
        card.appendChild(pickBtn);

        pickBtn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          if (STATE.selectedIds.has(id)) {
            STATE.selectedIds.delete(id);
          } else {
            STATE.selectedIds.add(id);
          }
          renderPanel();
          decorateListingCardsInDOM();
        });
      }

      const isSelected = STATE.selectedIds.has(id);
      if (isSelected) {
        pickBtn.classList.add("selected");
        pickBtn.innerHTML = "&#10003;";
      } else {
        pickBtn.classList.remove("selected");
        pickBtn.innerHTML = "";
      }

      // Age badge
      const itemData = STATE.activeListingsMap[id];
      if (itemData && itemData.creationTimeMs) {
        let ageBadge = card.querySelector(`.rlf-age[data-id="${id}"]`);
        if (!ageBadge) {
          ageBadge = document.createElement("div");
          ageBadge.className = "rlf-age";
          ageBadge.setAttribute("data-id", id);
          card.appendChild(ageBadge);
        }

        const ageDays = itemData.ageDays;
        ageBadge.textContent = formatTimeAgo(itemData.creationTimeMs);
        if (ageDays >= STATE.staleDays) {
          ageBadge.classList.add("stale");
        } else {
          ageBadge.classList.remove("stale");
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // 8. Initialization & Mutation Observer
  // --------------------------------------------------------------------------
  async function init() {
    try {
      const stored = await chrome.storage.sync.get([STORAGE_KEYS.PRICE_DROP, STORAGE_KEYS.SPEED_PACING]);
      if (stored[STORAGE_KEYS.PRICE_DROP]) {
        STATE.priceDrop = stored[STORAGE_KEYS.PRICE_DROP];
      }
      if (stored[STORAGE_KEYS.SPEED_PACING]) {
        STATE.pacingMultiplier = Number(stored[STORAGE_KEYS.SPEED_PACING]) || 1.01;
      }
    } catch (e) {}

    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.COLLAPSED);
      if (typeof stored[STORAGE_KEYS.COLLAPSED] === "boolean") {
        STATE.isPanelCollapsed = stored[STORAGE_KEYS.COLLAPSED];
      }
    } catch (e) {}

    if (isSellingPage()) {
      // Box first, work second. Waiting on ensureTokens() here used to leave
      // the page with no panel at all whenever token reading stalled.
      STATE.scanState = "scanning";
      renderPanel();
      scanActiveListings().catch(() => {
        STATE.scanState = "empty";
        renderPanel();
      });
    }

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (isSellingPage()) {
        if (!document.getElementById("rlf-select-btn")) {
          renderPanel();
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          decorateListingCardsInDOM();
        }, 400);
      }
    });

    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (isSellingPage()) {
          renderPanel();
          scanActiveListings();
        }
      }
    }, 600);

    window.addEventListener("popstate", () => {
      if (isSellingPage()) {
        renderPanel();
        scanActiveListings();
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.kind === MSG.SCAN_LISTINGS) {
      scanActiveListings();
      sendResponse({ ok: true });
    }
    return true;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();