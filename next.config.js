// @ts-check

'use strict';
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dns = require('dns');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withJupyterWorkspaces } = require('@gen3/workspaces/server');

dns.setDefaultResultOrder('ipv4first');

const basePath = process.env.BASE_PATH || '';

const isDev = process.env.NODE_ENV === 'development';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withMDX = require('@next/mdx')({
  extension: /\.(md|mdx)$/,
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

// get the version of the frontend package
const packageJson = require(
  path.resolve(
    __dirname,
    'node_modules',
    '@gen3',
    'frontend',
    'package.json',
  ),
);


console.log('version:', packageJson.version);

// Next configuration with support for writing API to existing common services
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The development pages load the sample dictionary with a guarded require that a production build drops; keep the
  // sample file itself out of the standalone output (and so out of the image) as well.
  outputFileTracingExcludes: { '/dev/*': ['./src/lib/dictionary/sample.ts'] },
  env: {
    version: process.env.npm_package_version,
    NEXT_PUBLIC_GEN3_VERSION: packageJson.version,
  },
  reactStrictMode: true,
  pageExtensions: ['mdx', 'md', 'jsx', 'js', 'tsx', 'ts'],
  basePath: basePath,
  // @perspective-dev/viewer ships two TypeScript source files that its grid and chart plugins import at run time;
  // webpack must compile them (see the alias in the webpack function below).
  transpilePackages: ['@gen3/core', '@gen3/frontend', '@gen3/workspaces', '@perspective-dev/viewer'],
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  webpack: (config) => {
    config.infrastructureLogging = {
      level: 'error',
    };
    // Perspective's WebAssembly engines are served as static files and imported as URLs (the data grid fetches them
    // once, client-side only). Scoped to @perspective-dev so no other .wasm handling changes.
    // The datagrid and chart plugins import these two files by a `.js` name that exists only as `.ts` in the package.
    const perspectiveSrc = path.resolve(__dirname, 'node_modules', '@perspective-dev', 'viewer', 'src', 'ts');
    config.resolve.alias = {
      ...config.resolve.alias,
      '@perspective-dev/viewer/src/ts/column-format.js$': path.join(perspectiveSrc, 'column-format.ts'),
      '@perspective-dev/viewer/src/ts/extensions.js$': path.join(perspectiveSrc, 'extensions.ts'),
    };
    // Two Perspective bundles import() URLs built at run time; webpack must leave those calls to the browser.
    config.module.rules.push({
      test: /\.js$/,
      include: /node_modules[\\/]@perspective-dev[\\/](viewer|viewer-charts)[\\/]dist[\\/]esm[\\/]perspective-viewer(-charts)?\.js$/,
      enforce: 'post',
      loader: path.resolve(__dirname, 'src/lib/vectis-kit/data-table/webpackIgnoreImports.cjs'),
    });
    config.module.rules.push({
      test: /\.wasm$/,
      include: /node_modules[\\/]@perspective-dev[\\/]/,
      type: 'asset/resource',
      generator: { filename: 'static/wasm/[name].[hash][ext]' },
    });
    return config;
  },
  async rewrites() {
    const workspaceApiRewrite = [
      {
        source: '/workspace-api/:path*',
        destination: '/api/:path*',
      },
      {
        source:
          '/lw-workspace/proxy/jeg-proxy/kernelspecs/python_tf_kubernetes/logo-64x64.png',
        destination: '/icons/kernels/logo-64.png',
      },
    ];
    if (isDev) {
      const GEN3_TARGET =
        process.env.NEXT_PUBLIC_GEN3_API_TARGET || 'https://localhost';

      return [
        ...workspaceApiRewrite,
        { source: '/_status', destination: `${GEN3_TARGET}/_status` },
        { source: '/user/:path*', destination: `${GEN3_TARGET}/user/:path*` },
        {
          source: '/guppy/:path*',
          destination: `${GEN3_TARGET}/guppy/:path*`,
        },
        { source: '/job/:path*', destination: `${GEN3_TARGET}/job/:path*` },
        { source: '/mds/:path*', destination: `${GEN3_TARGET}/mds/:path*` },
        {
          source: '/ai-search/:path*',
          destination: `${GEN3_TARGET}/ai-search/:path*`,
        },
        {
          source: '/authz/:path*',
          destination: `${GEN3_TARGET}/authz/:path*`,
        },
        {
          source: '/lw-workspace/proxy/',
          destination: `${GEN3_TARGET}/lw-workspace/proxy/`,
        },
        {
          source: '/lw-workspace/:path*',
          destination: `${GEN3_TARGET}/lw-workspace/:path*`,
        },
        {
          source: '/api/v0/submission/:path*',
          destination: `${GEN3_TARGET}/api/v0/submission/:path*`,
        },
        { source: '/wts/:path*', destination: `${GEN3_TARGET}/wts/:path*` },
        {
          source: '/library/lists/:path*',
          destination: `${GEN3_TARGET}/library/lists/:path*`,
        },

        {
          source: '/manifests/:path*',
          destination: `${GEN3_TARGET}/manifests/:path*`,
        },
        {
          source: '/dashboard/:path*',
          destination: `${GEN3_TARGET}/dashboard/:path*`,
        },
        {
          source: '/requestor/:path*',
          destination: `${GEN3_TARGET}/requestor/:path*`,
        },
        {
          source: '/index/:path*',
          destination: `${GEN3_TARGET}/index/:path*`,
        },
        {
          source: '/login',
          destination: `${GEN3_TARGET}/login`,
        },
      ];
    } else {
      return workspaceApiRewrite;
    }
  },
  async headers() {
    return [
      {
        source: '/(.*)?', // Matches all pages
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
      {
        source: '/Workspaces/(.*)?',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            // 'credentialless' is less strict than 'require-corp' — allows
            // cross-origin iframes without CORP headers, needed in dev when
            // the remote Jupyter server doesn't send COEP headers.
            value: isDev ? 'credentialless' : 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
    ];
  },
};

// IMPORTANT: actually export your config (wrapped by plugins)
module.exports = withMDX(withJupyterWorkspaces(nextConfig));
