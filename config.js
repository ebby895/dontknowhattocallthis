// config.js
const CONFIG = {
  // 🟢 Backend / API
  apiBase: "https://9roa2qwu7e.execute-api.us-west-1.amazonaws.com/prod",
  metadataPath: "/metadata/",
  uploadPath: "/upload/",
  region: "us-west-1",
  apiKey: "",

  // 🖼️ Media / Listing Options
  maxImages: 10,
  maxThumbnailSize: 1280,
  jpegQuality: 0.82,

  // ⚙️ General Environment Settings
  environment: "production",
  enableDebug: true,

  // 🧩 UI / Behavior
  defaultToastDuration: 2500,
  enableAutoPublish: true,
  ffmEnableAutoActiveScan: true,
  autoPruneCloudFiles: true // If true, automatically prune unused S3 files after sync
};

console.log("[AutoList Pro] Config loaded:", CONFIG);

// Expose global CONFIG for UI modules and allow localStorage overrides for small flags
try {
  if (typeof globalThis !== 'undefined') {
    globalThis.CONFIG = globalThis.CONFIG || CONFIG;
    try {
      const stored = (typeof localStorage !== 'undefined') ? localStorage.getItem('autoPruneCloudFiles') : null;
      if (stored !== null) {
        globalThis.CONFIG.autoPruneCloudFiles = (stored === 'true');
      }
    } catch (e) { /* ignore localStorage errors */ }
    try { if (typeof window !== 'undefined') window.CONFIG = globalThis.CONFIG; } catch (e) {}
  }
} catch (e) { /* ignore */ }

// Centralized AutoList Pro runtime configuration (Phase 2)
try {
  if (typeof globalThis !== 'undefined') {
    globalThis.FFM_CONFIG = globalThis.FFM_CONFIG || {
      // existing config values (kept here so callers can switch to FFM_CONFIG)
      apiBase: (globalThis.CONFIG && globalThis.CONFIG.apiBase) ? globalThis.CONFIG.apiBase : 'https://9roa2qwu7e.execute-api.us-west-1.amazonaws.com/prod',
      region: (globalThis.CONFIG && globalThis.CONFIG.region) ? globalThis.CONFIG.region : 'us-west-1',

      // 🔑 Supabase (Phase 2)
      supabaseUrl: 'https://azzpfqnnuopycodqywnm.supabase.co',
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6enBmcW5udW9weWNvZHF5d25tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MTk5NDgsImV4cCI6MjA4MDk5NTk0OH0.YvbIWwP5zEMaqSAYoHLgJAr_ssWYyny0BU31_oJqED8'
    };
    // keep window.FFM_CONFIG for window contexts
    try { if (typeof window !== 'undefined') window.FFM_CONFIG = globalThis.FFM_CONFIG; } catch (e) {}
    console.log('[AutoList Pro] FFM_CONFIG loaded');
  }
} catch (e) { /* ignore */ }

// Prevent accidental mutation of runtime config (helps catch overwrites)
try { if (typeof globalThis !== 'undefined' && globalThis.FFM_CONFIG) Object.freeze(globalThis.FFM_CONFIG); } catch (e) {}
