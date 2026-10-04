---
applyTo: "**/*.ts,**/*.tsx,**/package.json,**/vite.config.*,**/.yarnrc.yml,**/yarn.lock,**/gui/**"
---

Apply the [general coding guidelines](./style-general.instructions.md) to all code.

# General Project Guidelines
- Prefer using `export default function` over exporting at the end of the file.

# Package Management
- **Always use yarn instead of npm** for all package management operations
- Use `yarn install` instead of `npm install`
- Use `yarn add <package>` instead of `npm install <package>`
- Use `yarn remove <package>` instead of `npm uninstall <package>`
- Use `yarn dev` instead of `npm run dev`
- Use `yarn build` instead of `npm run build`

# Build Process
- BioLib GUI projects use Vite for building and development
- The build process compiles TypeScript and React into a single HTML file
- Always run `yarn build` to create the production build before deployment
- Use `yarn dev` for local development with hot reloading

# Configuration Files
- Respect the `.yarnrc.yml` configuration for yarn settings
- The `package.json` should specify `"packageManager": "yarn@4.6.0"` or similar
- Never modify yarn.lock manually - let yarn manage it automatically

# Dependencies
- Add new dependencies using `yarn add <package>` for runtime dependencies
- Add development dependencies using `yarn add -D <package>`
- Keep dependencies up to date but test thoroughly after updates

# TypeScript Guidelines
- Use TypeScript for all new code
- Follow functional programming principles where possible
- Use interfaces for data structures prefixed with I like `interface IRecord`
- Prefer immutable data (const, readonly)
- Use optional chaining (?.) and nullish coalescing (??) operators

# React Guidelines
- Use functional components with hooks
- Follow the React hooks rules (no conditional hooks)
- Prefer one component per file
- Use Tailwindcss for styling
- Extract props in components with object destructuring like `const { prop1, prop2 } = props;`
- Instantiate functional components with props like `export default function MyComponent(props: IProps) { ... }`.
