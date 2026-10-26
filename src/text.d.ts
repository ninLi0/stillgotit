declare module "*.md" {
  const text: string;
  export default text;
}
// Stylesheets that frontend modules import for their side effects, such as KaTeX's. Vite bundles them; the tests that
// import those modules only need the import to type-check.
declare module "*.css" {}
