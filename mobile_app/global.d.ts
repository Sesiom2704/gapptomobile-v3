// global.d.ts
// Para que TypeScript sepa cómo tratar las imágenes

declare module '*.png' {
  const value: any;
  export default value;
}