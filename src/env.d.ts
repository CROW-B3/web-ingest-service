// Ensures Env is available regardless of wrangler types --env-interface flag
// CI uses --env-interface CloudflareBindings which generates CloudflareBindings
// instead of Env. This bridges the gap.
interface Env extends Cloudflare.Env {}
