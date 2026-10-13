/**
 * Webpack loader used ONLY for two Perspective bundles (see next.config.js).
 *
 * Those files start their WebAssembly glue and chart workers with `import(blobUrl)`, where the URL is created at run
 * time. Webpack cannot bundle an import whose target is a variable, and rewrites it into a lookup that then fails with
 * "Cannot find module 'blob:...'". The magic comment makes webpack leave the call alone so the browser runs it natively,
 * which is what the library intends.
 *
 * Only calls that are not method calls (`x.import(`) are changed.
 */
module.exports = function webpackIgnoreImports(source) {
  return String(source).replace(/(^|[^\w$.])import\((?!\s*\/\*\s*webpackIgnore)/g, '$1import(/* webpackIgnore: true */ ');
};
