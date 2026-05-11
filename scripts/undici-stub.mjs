// Stub for `undici`, aliased in at build time.
//
// @actions/core statically imports OidcClient -> @actions/http-client -> undici,
// which drags ~300 KB into the bundle. This action never calls getIDToken(),
// so undici's ProxyAgent is never actually constructed. Providing a no-op
// class lets module loading succeed without bundling the real package.
export class ProxyAgent {}
