// The bundler turns an imported .wasm file into the URL it is served from (see the asset rule in next.config.js).
declare module '*.wasm' {
  const url: string;
  export default url;
}
